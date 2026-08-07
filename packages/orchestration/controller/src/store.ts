import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

import {
  type ExecutionResult,
  type ProviderArtifact,
  type ProviderReference,
  type RunPlan,
  RunPlanSchema,
} from "@reef/orchestrator";

import {
  ControllerError,
  DuplicateWorkError,
  type ExistingRunInfo,
} from "./errors.js";
import {
  assertPrivateFile,
  ensurePrivateDirectory,
  readPrivateJson,
  removePrivateFile,
  writeAtomicJson,
  writeExclusiveJson,
} from "./filesystem.js";
import {
  type MaybePromise,
  type ProcessIdentityProbe,
  type ProcessLiveness,
  defaultProcessIdentityProbe,
} from "./processIdentity.js";
import {
  CONTROLLER_STATE_SCHEMA_VERSION,
  ControllerArtifactSchema,
  type ControllerClaim,
  type ControllerClaimInput,
  ControllerClaimInputSchema,
  ControllerClaimSchema,
  ControllerExecutionResultSchema,
  type ControllerOwner,
  ControllerOwnerSchema,
  ControllerProviderReferenceSchema,
  type ControllerState,
  ControllerStateSchema,
  ControllerTimestampSchema,
  type ControllerUpdateInput,
  ControllerUpdateInputSchema,
  type ControllerUpdateOperation,
  ControllerUriSchema,
  type ProcessIdentity,
  parseControllerClaim,
  parseControllerState,
} from "./schema.js";

const RECORDS_DIRECTORY = "records";
const CLAIMS_DIRECTORY = "claims";
const PHASE_ORDER = [
  "prepared",
  "preflight",
  "running",
  "cleanup",
  "terminal",
] as const;

const FORBIDDEN_KEYS = new Set([
  "prompt",
  "raw_log",
  "rawlog",
  "raw_error",
  "rawerror",
  "cause",
  "environment",
  "credential",
  "credentials",
  "password",
  "token",
  "api_key",
  "apikey",
  "process_handle",
  "processhandle",
  "filesystem_path",
  "filesystempath",
  "workspace_path",
  "workspacepath",
  "provider_payload",
  "providerpayload",
]);

type JsonObject = { readonly [key: string]: JsonValue };
type JsonValue =
  | JsonObject
  | readonly JsonValue[]
  | string
  | number
  | boolean
  | null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeKey = (value: string): string =>
  value.toLowerCase().replaceAll("-", "_");

const canonicalizeJson = (
  value: unknown,
  ancestors = new Set<object>(),
): JsonValue => {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new ControllerError("state_schema_invalid");
    return value;
  }
  if (typeof value !== "object")
    throw new ControllerError("state_schema_invalid");
  if (ancestors.has(value)) throw new ControllerError("state_schema_invalid");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => canonicalizeJson(item, ancestors));
    }
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of entries) {
      if (FORBIDDEN_KEYS.has(normalizeKey(key))) {
        throw new ControllerError("state_schema_invalid");
      }
      result[key] = canonicalizeJson(item, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
};

const serializeSafe = (
  value: unknown,
  redactionValues: readonly string[],
): string => {
  const canonical = canonicalizeJson(value);
  const serialized = JSON.stringify(canonical);
  if (!serialized) throw new ControllerError("state_schema_invalid");
  if (redactionValues.some((secret) => serialized.includes(secret))) {
    throw new ControllerError("secret_material_detected");
  }
  return `${serialized}\n`;
};

const equalJson = (
  left: unknown,
  right: unknown,
  redactionValues: readonly string[],
): boolean =>
  serializeSafe(left, redactionValues) ===
  serializeSafe(right, redactionValues);

const readClock = (clock: () => Date): Date => {
  let now: Date;
  try {
    now = clock();
  } catch {
    throw new ControllerError("clock_invalid");
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new ControllerError("clock_invalid");
  }
  return now;
};

const timestamp = (clock: () => Date): string => {
  const now = readClock(clock);
  const value = now.toISOString();
  const parsed = ControllerTimestampSchema.safeParse(value);
  if (!parsed.success) throw new ControllerError("clock_invalid");
  return parsed.data;
};

const hashWorkUri = (workUri: string): string =>
  createHash("sha256").update(workUri, "utf8").digest("hex");

const phaseIndex = (phase: ControllerState["phase"]): number =>
  PHASE_ORDER.indexOf(phase);

const sameOwner = (left: ControllerOwner, right: ControllerOwner): boolean =>
  left.controllerId === right.controllerId &&
  left.process.pid === right.process.pid &&
  left.process.startTime === right.process.startTime;

const sameReference = (
  left: ProviderReference | null,
  right: ProviderReference,
  redactionValues: readonly string[],
): boolean => left !== null && equalJson(left, right, redactionValues);

const artifactKey = (
  artifact: ProviderArtifact,
  redactionValues: readonly string[],
): string => serializeSafe(artifact, redactionValues);

const existingRunInfo = (state: ControllerState): ExistingRunInfo => ({
  runId: state.runId,
  workUri: state.plan.work.uri,
  phase: state.phase,
  revision: state.revision,
  startedAt: state.startedAt,
  updatedAt: state.updatedAt,
});

export interface ControllerStoreOptions {
  readonly stateRoot: string;
  readonly staleAfterMs: number;
  readonly redactionValues?: readonly string[];
  readonly controllerId?: string;
  readonly clock?: () => Date;
  readonly processIdentity?: ProcessIdentityProbe;
}

export interface ControllerInspection {
  readonly classification: "active" | "terminal" | "interrupted" | "stale";
  readonly liveness: ProcessLiveness | "released";
  readonly state: ControllerState;
  readonly allowedActions: readonly ("update" | "cleanup")[];
}

export type WorkspaceCleanup = (
  workspace: ProviderReference,
  signal: AbortSignal,
) => MaybePromise<void>;

export interface ControllerCleanupResult {
  readonly runId: string;
  readonly workUri: string;
  readonly removed: true;
}

export interface ControllerStore {
  claim(input: ControllerClaimInput): Promise<ControllerState>;
  update(input: ControllerUpdateInput): Promise<ControllerState>;
  inspect(workUri: string): Promise<ControllerInspection>;
  cleanup(
    workUri: string,
    onWorkspaceCleanup?: WorkspaceCleanup,
  ): Promise<ControllerCleanupResult>;
}

const validateRedactionValues = (
  values: readonly string[] | undefined,
): readonly string[] => {
  if (!values) return [];
  if (!Array.isArray(values)) {
    throw new ControllerError("invalid_redaction_value");
  }
  const result = [...values];
  if (result.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new ControllerError("invalid_redaction_value");
  }
  return Object.freeze(result);
};

const validateStateRoot = (value: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ControllerError("invalid_state_root");
  }
  const absolute = resolve(value);
  if (absolute === resolve("/"))
    throw new ControllerError("invalid_state_root");
  return absolute;
};

const validateControllerId = (value: string | undefined): string => {
  const candidate = value ?? `controller-${randomUUID()}`;
  const parsed = ControllerOwnerSchema.shape.controllerId.safeParse(candidate);
  if (!parsed.success) throw new ControllerError("process_identity_invalid");
  return parsed.data;
};

const parsePlan = (value: unknown): RunPlan => {
  const version =
    isRecord(value) && "schemaVersion" in value
      ? value.schemaVersion
      : undefined;
  if (version === undefined) throw new ControllerError("invalid_run_plan");
  if (version !== 1) throw new ControllerError("unsupported_schema_version");
  const parsed = RunPlanSchema.safeParse(value);
  if (!parsed.success) throw new ControllerError("invalid_run_plan");
  return parsed.data;
};

const validateRunId = (value: unknown): string => {
  if (typeof value !== "string") throw new ControllerError("invalid_run_id");
  const trimmed = value.trim();
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(trimmed) ||
    trimmed.includes("..")
  ) {
    throw new ControllerError("invalid_run_id");
  }
  return trimmed;
};

const parseWorkUri = (value: unknown): string => {
  const parsed = ControllerUriSchema.safeParse(value);
  if (!parsed.success) throw new ControllerError("invalid_update");
  return parsed.data;
};

const assertResultMatchesPlan = (
  result: ExecutionResult,
  plan: RunPlan,
): void => {
  const parsed = ControllerExecutionResultSchema.safeParse(result);
  if (!parsed.success) throw new ControllerError("terminal_result_mismatch");
  const provenance = result.provenance;
  if (
    provenance.schemaVersion !== plan.schemaVersion ||
    provenance.workUri !== plan.work.uri ||
    provenance.workRevision !== plan.work.snapshot.revision ||
    provenance.workSource !== plan.work.snapshot.provenance.source ||
    provenance.workSourceRevision !== plan.work.snapshot.provenance.revision ||
    provenance.inputSource !== plan.inputProvenance.source ||
    provenance.inputRevision !== plan.inputProvenance.revision ||
    provenance.planCreatedAt !== plan.createdAt ||
    result.completedPhases.at(-1) !== "terminal"
  ) {
    throw new ControllerError("terminal_result_mismatch");
  }
};

class FilesystemControllerStore implements ControllerStore {
  private readonly stateRoot: string;
  private readonly staleAfterMs: number;
  private readonly redactionValues: readonly string[];
  private readonly controllerId: string;
  private readonly clock: () => Date;
  private readonly processIdentity: ProcessIdentityProbe;

  constructor(options: ControllerStoreOptions) {
    this.stateRoot = validateStateRoot(options.stateRoot);
    if (!Number.isFinite(options.staleAfterMs) || options.staleAfterMs <= 0) {
      throw new ControllerError("invalid_state_root");
    }
    this.staleAfterMs = options.staleAfterMs;
    this.redactionValues = validateRedactionValues(options.redactionValues);
    this.controllerId = validateControllerId(options.controllerId);
    this.clock = options.clock ?? (() => new Date());
    this.processIdentity =
      options.processIdentity ?? defaultProcessIdentityProbe;
  }

  private recordsDirectory(): string {
    return join(this.stateRoot, RECORDS_DIRECTORY);
  }

  private claimsDirectory(): string {
    return join(this.stateRoot, CLAIMS_DIRECTORY);
  }

  private recordPath(runId: string): string {
    return join(this.recordsDirectory(), `${runId}.json`);
  }

  private claimPath(workUri: string): string {
    return join(this.claimsDirectory(), `${hashWorkUri(workUri)}.json`);
  }

  private async ensureLayout(): Promise<void> {
    await ensurePrivateDirectory(this.stateRoot, this.stateRoot);
    await ensurePrivateDirectory(this.stateRoot, this.recordsDirectory());
    await ensurePrivateDirectory(this.stateRoot, this.claimsDirectory());
  }

  private async owner(): Promise<ControllerOwner> {
    let process: ProcessIdentity;
    try {
      process = await this.processIdentity.current();
    } catch {
      throw new ControllerError("process_identity_invalid");
    }
    const parsed = ControllerOwnerSchema.safeParse({
      controllerId: this.controllerId,
      process,
    });
    if (!parsed.success) throw new ControllerError("process_identity_invalid");
    return parsed.data;
  }

  private async readState(path: string): Promise<ControllerState | null> {
    const raw = await readPrivateJson(this.stateRoot, path);
    if (raw === null) return null;
    try {
      const state = parseControllerState(raw);
      serializeSafe(state, this.redactionValues);
      return state;
    } catch (error) {
      if (error instanceof ControllerError) {
        if (error.code === "malformed_state") throw error;
        throw error;
      }
      throw new ControllerError("state_schema_invalid");
    }
  }

  private async readClaim(path: string): Promise<ControllerClaim | null> {
    let raw: unknown | null;
    try {
      raw = await readPrivateJson(this.stateRoot, path);
    } catch (error) {
      if (
        error instanceof ControllerError &&
        error.code === "malformed_state"
      ) {
        throw new ControllerError("malformed_claim");
      }
      throw error;
    }
    if (raw === null) return null;
    try {
      const claim = parseControllerClaim(raw);
      serializeSafe(claim, this.redactionValues);
      return claim;
    } catch (error) {
      if (error instanceof ControllerError) {
        if (error.code === "malformed_state") {
          throw new ControllerError("malformed_claim");
        }
        throw error;
      }
      throw new ControllerError("claim_schema_invalid");
    }
  }

  private assertClaimMatchesState(
    claim: ControllerClaim,
    state: ControllerState,
  ): void {
    if (
      claim.workUri !== state.plan.work.uri ||
      claim.workKey !== hashWorkUri(claim.workUri) ||
      claim.runId !== state.runId ||
      !sameOwner(claim.owner, state.owner)
    ) {
      throw new ControllerError("claim_record_mismatch");
    }
    const stateInterrupted = state.interruptedAt !== null;
    const stateTerminal = state.phase === "terminal";
    if (!stateInterrupted && !stateTerminal && claim.status !== "active") {
      throw new ControllerError("claim_record_mismatch");
    }
  }

  private async readRunById(runId: string): Promise<{
    state: ControllerState;
    claim: ControllerClaim;
    recordPath: string;
    claimPath: string;
  }> {
    const recordPath = this.recordPath(runId);
    const state = await this.readState(recordPath);
    if (state === null) throw new ControllerError("run_not_found");
    const claimPath = this.claimPath(state.plan.work.uri);
    const claim = await this.readClaim(claimPath);
    if (claim === null) throw new ControllerError("claim_record_mismatch");
    this.assertClaimMatchesState(claim, state);
    return { state, claim, recordPath, claimPath };
  }

  private async readRunByWorkUri(workUri: string): Promise<{
    state: ControllerState;
    claim: ControllerClaim;
    recordPath: string;
    claimPath: string;
  }> {
    const claimPath = this.claimPath(workUri);
    const claim = await this.readClaim(claimPath);
    if (claim === null) throw new ControllerError("run_not_found");
    if (claim.workUri !== workUri || claim.workKey !== hashWorkUri(workUri)) {
      throw new ControllerError("claim_record_mismatch");
    }
    const recordPath = this.recordPath(claim.runId);
    const state = await this.readState(recordPath);
    if (state === null) throw new ControllerError("claim_record_mismatch");
    this.assertClaimMatchesState(claim, state);
    return { state, claim, recordPath, claimPath };
  }

  private async releaseClaim(
    claimPath: string,
    expected: ControllerClaim,
  ): Promise<void> {
    const current = await this.readClaim(claimPath);
    if (
      current === null ||
      !equalJson(current, expected, this.redactionValues)
    ) {
      throw new ControllerError("claim_release_failed");
    }
    if (current.status === "released") return;
    const releasedAt = timestamp(this.clock);
    const released: ControllerClaim = {
      ...current,
      status: "released",
      releasedAt,
    };
    const serialized = serializeSafe(released, this.redactionValues);
    try {
      await writeAtomicJson(this.stateRoot, claimPath, serialized);
      const readBack = await this.readClaim(claimPath);
      if (
        readBack === null ||
        !equalJson(readBack, released, this.redactionValues)
      ) {
        throw new ControllerError("claim_release_failed");
      }
    } catch (error) {
      if (error instanceof ControllerError) {
        if (error.code === "malformed_state") {
          throw new ControllerError("malformed_claim");
        }
        if (error.code === "secret_material_detected") throw error;
        throw new ControllerError("claim_release_failed");
      }
      throw new ControllerError("claim_release_failed");
    }
  }

  private async assertOwnerAndRevision(
    runId: string,
    expectedRevision: number,
  ): Promise<{
    state: ControllerState;
    claim: ControllerClaim;
    recordPath: string;
    claimPath: string;
  }> {
    const current = await this.readRunById(runId);
    if (current.state.revision !== expectedRevision) {
      throw new ControllerError("revision_conflict");
    }
    const owner = await this.owner();
    if (!sameOwner(current.state.owner, owner)) {
      throw new ControllerError("ownership_lost");
    }
    if (current.claim.status !== "active") {
      throw new ControllerError("claim_released");
    }
    return current;
  }

  async claim(input: ControllerClaimInput): Promise<ControllerState> {
    const parsedInput = ControllerClaimInputSchema.safeParse(input);
    if (!parsedInput.success) throw new ControllerError("invalid_run_id");
    const runId = validateRunId(parsedInput.data.runId);
    const plan = parsePlan(parsedInput.data.plan);
    const owner = await this.owner();
    const now = timestamp(this.clock);
    const state: ControllerState = {
      schemaVersion: CONTROLLER_STATE_SCHEMA_VERSION,
      runId,
      plan,
      revision: 0,
      owner,
      phase: "prepared",
      workspace: null,
      artifacts: [],
      startedAt: now,
      updatedAt: now,
      interruptedAt: null,
      terminalResult: null,
    };
    const stateResult = ControllerStateSchema.safeParse(state);
    if (!stateResult.success) throw new ControllerError("state_schema_invalid");
    const claim: ControllerClaim = {
      schemaVersion: CONTROLLER_STATE_SCHEMA_VERSION,
      runId,
      workUri: plan.work.uri,
      workKey: hashWorkUri(plan.work.uri),
      owner,
      status: "active",
      claimedAt: now,
      releasedAt: null,
    };
    const claimResult = ControllerClaimSchema.safeParse(claim);
    if (!claimResult.success) throw new ControllerError("claim_schema_invalid");
    const stateSerialized = serializeSafe(state, this.redactionValues);
    const claimSerialized = serializeSafe(claim, this.redactionValues);

    await this.ensureLayout();
    const recordPath = this.recordPath(runId);
    const claimPath = this.claimPath(plan.work.uri);
    let stateCreated = false;
    let claimCreated = false;
    try {
      stateCreated = await writeExclusiveJson(
        this.stateRoot,
        recordPath,
        stateSerialized,
      );
      if (!stateCreated) throw new ControllerError("run_id_conflict");
      const readBack = await this.readState(recordPath);
      if (
        readBack === null ||
        !equalJson(readBack, state, this.redactionValues)
      ) {
        throw new ControllerError("claim_record_mismatch");
      }
      claimCreated = await writeExclusiveJson(
        this.stateRoot,
        claimPath,
        claimSerialized,
      );
      if (!claimCreated) {
        const existingClaim = await this.readClaim(claimPath);
        if (existingClaim === null) throw new ControllerError("duplicate_work");
        if (existingClaim.workUri !== plan.work.uri) {
          throw new ControllerError("claim_record_mismatch");
        }
        const existingState = await this.readState(
          this.recordPath(existingClaim.runId),
        );
        if (existingState === null)
          throw new ControllerError("claim_record_mismatch");
        this.assertClaimMatchesState(existingClaim, existingState);
        throw new DuplicateWorkError(existingRunInfo(existingState));
      }
      const claimReadBack = await this.readClaim(claimPath);
      if (
        claimReadBack === null ||
        !equalJson(claimReadBack, claim, this.redactionValues)
      ) {
        throw new ControllerError("claim_record_mismatch");
      }
      this.assertClaimMatchesState(claimReadBack, readBack);
      return readBack;
    } catch (error) {
      try {
        if (claimCreated) {
          const currentClaim = await this.readClaim(claimPath);
          if (
            currentClaim !== null &&
            currentClaim.runId === runId &&
            currentClaim.workUri === plan.work.uri &&
            sameOwner(currentClaim.owner, owner)
          ) {
            await removePrivateFile(this.stateRoot, claimPath);
          }
        }
        if (stateCreated) {
          const currentState = await this.readState(recordPath).catch(
            () => null,
          );
          if (
            currentState !== null &&
            currentState.runId === runId &&
            currentState.plan.work.uri === plan.work.uri &&
            sameOwner(currentState.owner, owner)
          ) {
            await removePrivateFile(this.stateRoot, recordPath);
          }
        }
      } catch {
        // Preserve an uncertain claim rather than deleting a path we can no
        // longer prove is owned by this claim attempt.
      }
      if (error instanceof ControllerError) throw error;
      throw new ControllerError("filesystem_io");
    }
  }

  async update(input: ControllerUpdateInput): Promise<ControllerState> {
    const parsedInput = ControllerUpdateInputSchema.safeParse(input);
    if (!parsedInput.success) throw new ControllerError("invalid_update");
    const runId = validateRunId(parsedInput.data.runId);
    const operation = parsedInput.data.operation as ControllerUpdateOperation;
    const initial = await this.readRunById(runId);
    if (
      parsedInput.data.expectedRevision !== undefined &&
      parsedInput.data.expectedRevision !== initial.state.revision
    ) {
      throw new ControllerError("revision_conflict");
    }
    const currentOwner = await this.owner();
    if (!sameOwner(initial.state.owner, currentOwner)) {
      throw new ControllerError("ownership_lost");
    }
    if (initial.state.phase === "terminal") {
      throw new ControllerError("terminal_mutation_rejected");
    }
    if (initial.state.interruptedAt !== null) {
      if (operation.type === "interrupted") return initial.state;
      throw new ControllerError("interrupted_mutation_rejected");
    }
    if (initial.claim.status !== "active")
      throw new ControllerError("claim_released");

    let next: ControllerState = initial.state;
    let shouldReleaseClaim = false;
    if (operation.type === "phase") {
      if (operation.phase === "terminal") {
        throw new ControllerError("invalid_update");
      }
      const currentIndex = phaseIndex(initial.state.phase);
      const nextIndex = phaseIndex(operation.phase);
      if (nextIndex < currentIndex)
        throw new ControllerError("phase_regression");
      if (nextIndex === currentIndex) return initial.state;
      next = {
        ...initial.state,
        phase: operation.phase,
      };
    } else if (operation.type === "workspace") {
      const parsed = ControllerProviderReferenceSchema.safeParse(
        operation.reference,
      );
      if (!parsed.success) throw new ControllerError("invalid_update");
      if (
        sameReference(
          initial.state.workspace,
          parsed.data,
          this.redactionValues,
        )
      ) {
        return initial.state;
      }
      next = { ...initial.state, workspace: parsed.data };
    } else if (operation.type === "artifact") {
      const parsed = ControllerArtifactSchema.safeParse(operation.artifact);
      if (!parsed.success) throw new ControllerError("invalid_update");
      const key = artifactKey(parsed.data, this.redactionValues);
      if (
        initial.state.artifacts.some(
          (item) => artifactKey(item, this.redactionValues) === key,
        )
      ) {
        return initial.state;
      }
      next = {
        ...initial.state,
        artifacts: [...initial.state.artifacts, parsed.data],
      };
    } else if (operation.type === "terminal") {
      const parsed = ControllerExecutionResultSchema.safeParse(
        operation.result,
      );
      if (!parsed.success)
        throw new ControllerError("terminal_result_mismatch");
      const result = parsed.data as unknown as ExecutionResult;
      assertResultMatchesPlan(result, initial.state.plan);
      next = {
        ...initial.state,
        phase: "terminal",
        terminalResult: result,
      };
      shouldReleaseClaim = true;
    } else {
      const interruptedAt = timestamp(this.clock);
      next = {
        ...initial.state,
        updatedAt: interruptedAt,
        interruptedAt,
      };
      shouldReleaseClaim = true;
    }

    const updatedAt =
      operation.type === "interrupted" ? next.updatedAt : timestamp(this.clock);
    next = {
      ...next,
      revision: initial.state.revision + 1,
      updatedAt,
    };
    const parsedState = ControllerStateSchema.safeParse(next);
    if (!parsedState.success) throw new ControllerError("state_schema_invalid");
    const serialized = serializeSafe(next, this.redactionValues);
    const latest = await this.assertOwnerAndRevision(
      runId,
      initial.state.revision,
    );
    if (!equalJson(latest.state, initial.state, this.redactionValues)) {
      throw new ControllerError("revision_conflict");
    }
    await writeAtomicJson(this.stateRoot, latest.recordPath, serialized);
    const readBack = await this.readState(latest.recordPath);
    if (readBack === null || !equalJson(readBack, next, this.redactionValues)) {
      throw new ControllerError("state_schema_invalid");
    }
    if (shouldReleaseClaim)
      await this.releaseClaim(latest.claimPath, latest.claim);
    return readBack;
  }

  async inspect(workUri: string): Promise<ControllerInspection> {
    const canonicalUri = parseWorkUri(workUri);
    const run = await this.readRunByWorkUri(canonicalUri);
    const { state, claim } = run;
    if (state.phase === "terminal") {
      return {
        classification: "terminal",
        liveness: claim.status === "released" ? "released" : "unknown",
        state,
        allowedActions: ["cleanup"],
      };
    }
    if (state.interruptedAt !== null) {
      return {
        classification: "interrupted",
        liveness: claim.status === "released" ? "released" : "dead",
        state,
        allowedActions: ["cleanup"],
      };
    }
    let liveness: ProcessLiveness = "unknown";
    try {
      liveness = await this.processIdentity.probe(state.owner.process);
    } catch {
      liveness = "unknown";
    }
    if (liveness === "unknown") {
      return {
        classification: "active",
        liveness,
        state,
        allowedActions: [],
      };
    }
    if (liveness === "alive") {
      return {
        classification: "active",
        liveness,
        state,
        allowedActions: ["update"],
      };
    }
    const age = readClock(this.clock).getTime() - Date.parse(state.updatedAt);
    const classification = age > this.staleAfterMs ? "stale" : "interrupted";
    return {
      classification,
      liveness,
      state,
      allowedActions: ["cleanup"],
    };
  }

  async cleanup(
    workUri: string,
    onWorkspaceCleanup?: WorkspaceCleanup,
  ): Promise<ControllerCleanupResult> {
    const inspection = await this.inspect(workUri);
    if (
      inspection.classification !== "terminal" &&
      inspection.classification !== "interrupted" &&
      inspection.classification !== "stale"
    ) {
      throw new ControllerError("cleanup_not_allowed");
    }
    const run = await this.readRunByWorkUri(inspection.state.plan.work.uri);
    const { state } = run;
    if (state.revision !== inspection.state.revision) {
      throw new ControllerError("revision_conflict");
    }
    if (state.workspace !== null && !onWorkspaceCleanup) {
      throw new ControllerError("cleanup_failed");
    }
    if (state.workspace !== null && onWorkspaceCleanup) {
      try {
        await onWorkspaceCleanup(state.workspace, new AbortController().signal);
      } catch {
        throw new ControllerError("cleanup_failed");
      }
    }
    try {
      const latest = await this.readRunByWorkUri(state.plan.work.uri);
      if (
        !equalJson(latest.state, state, this.redactionValues) ||
        !equalJson(latest.claim, run.claim, this.redactionValues)
      ) {
        throw new ControllerError("cleanup_failed");
      }
      await assertPrivateFile(this.stateRoot, latest.recordPath);
      await assertPrivateFile(this.stateRoot, latest.claimPath);
      await removePrivateFile(this.stateRoot, latest.recordPath);
      await removePrivateFile(this.stateRoot, latest.claimPath);
    } catch {
      throw new ControllerError("cleanup_failed");
    }
    return {
      runId: state.runId,
      workUri: state.plan.work.uri,
      removed: true,
    };
  }
}

export const createControllerStore = (
  options: ControllerStoreOptions,
): ControllerStore => new FilesystemControllerStore(options);
