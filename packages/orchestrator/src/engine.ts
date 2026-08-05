import {
  type AnyProvider,
  type OperationInput,
  type OperationName,
  type OperationResult,
  PROVIDER_KINDS,
  type ProviderByKind,
  ProviderError,
  type ProviderErrorJson,
  type ProviderKind,
  invokeProviderOperation,
} from "./provider.js";
import { type RunPlan, deepFreeze } from "./runPlan.js";

type Awaitable<T> = T | PromiseLike<T>;

export type ProviderRegistry = Readonly<ProviderByKind>;

export type ExecutionOutcome = "succeeded" | "failed" | "cancelled";
export type ExecutionPhase = "preflight" | "running" | "cleanup" | "terminal";

export interface ExecutionProvenance {
  readonly schemaVersion: RunPlan["schemaVersion"];
  readonly workUri: string;
  readonly workRevision: string;
  readonly workSource: string;
  readonly workSourceRevision: string;
  readonly inputSource: string;
  readonly inputRevision: string;
  readonly planCreatedAt: string;
}

export type PreflightIssueField =
  | "provider"
  | "kind"
  | "id"
  | "version"
  | "capabilities"
  | "requiredCapabilities";

export type PreflightIssueCode =
  | "provider_missing"
  | "provider_kind_mismatch"
  | "provider_id_mismatch"
  | "provider_version_mismatch"
  | "provider_capability_drift"
  | "unsupported_capability";

export interface ExecutionPreflightIssue {
  readonly code: PreflightIssueCode;
  readonly path: readonly (string | number)[];
  readonly providerKind: ProviderKind;
  readonly providerId: string | null;
  readonly field: PreflightIssueField;
  readonly expected?: string | readonly string[];
  readonly actual?: string | readonly string[] | null;
  readonly capability?: string;
}

export interface PreflightExecutionFailure {
  readonly code: "preflight_failed";
  readonly issues: readonly ExecutionPreflightIssue[];
}

export interface EngineExecutionFailure {
  readonly code: "engine_failed";
}

export interface CleanupExecutionFailure {
  readonly code: "cleanup_failed";
}

export interface CancelledExecutionFailure {
  readonly code: "cancelled";
  readonly provider?: ProviderErrorJson;
}

export type ExecutionFailure =
  | PreflightExecutionFailure
  | EngineExecutionFailure
  | CleanupExecutionFailure
  | CancelledExecutionFailure
  | ProviderErrorJson;

export type CleanupFailure = CleanupExecutionFailure | ProviderErrorJson;

export interface CleanupOutcome {
  readonly index: number;
  readonly status: "succeeded" | "failed";
  readonly failure?: CleanupFailure;
}

export interface CleanupResult {
  readonly outcomes: readonly CleanupOutcome[];
}

export interface ExecutionEvent {
  readonly event: "execution.phase";
  readonly phase: ExecutionPhase;
  readonly at: string;
  readonly provenance: ExecutionProvenance;
  readonly outcome?: ExecutionOutcome;
  readonly failure?: ExecutionFailure | null;
  readonly cleanup?: CleanupResult;
}

export type ExecutionEventSink = (event: ExecutionEvent) => void;

export type InvokeProvider = <
  K extends ProviderKind,
  O extends OperationName<K>,
>(
  kind: K,
  operation: O,
  input: OperationInput<K, O>,
) => Promise<OperationResult<K, O>>;

export interface ExecutionCleanupContext {
  readonly plan: RunPlan;
  readonly providers: ProviderRegistry;
  readonly signal: AbortSignal;
  readonly now: () => Date;
  readonly invoke: InvokeProvider;
}

export type ExecutionCleanup = (
  context: ExecutionCleanupContext,
) => Awaitable<void>;

export interface ExecutionContext {
  readonly plan: RunPlan;
  readonly providers: ProviderRegistry;
  readonly signal: AbortSignal;
  readonly now: () => Date;
  readonly invoke: InvokeProvider;
  readonly registerCleanup: (cleanup: ExecutionCleanup) => void;
}

export type ExecutionTask = (context: ExecutionContext) => Awaitable<unknown>;

export interface ExecuteRunPlanOptions {
  readonly signal?: AbortSignal;
  readonly onEvent?: ExecutionEventSink;
  readonly now?: () => Date;
}

export interface ExecutionResultBase {
  readonly provenance: ExecutionProvenance;
  readonly completedPhases: readonly ExecutionPhase[];
  readonly cleanup: CleanupResult;
}

export interface SucceededExecutionResult extends ExecutionResultBase {
  readonly outcome: "succeeded";
  readonly failure: null;
}

export type FailedExecutionFailure =
  | PreflightExecutionFailure
  | EngineExecutionFailure
  | CleanupExecutionFailure
  | ProviderErrorJson;

export interface FailedExecutionResult extends ExecutionResultBase {
  readonly outcome: "failed";
  readonly failure: FailedExecutionFailure;
}

export interface CancelledExecutionResult extends ExecutionResultBase {
  readonly outcome: "cancelled";
  readonly failure: CancelledExecutionFailure;
}

export type ExecutionResult =
  | SucceededExecutionResult
  | FailedExecutionResult
  | CancelledExecutionResult;

const isAbortLike = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  return "name" in error && error.name === "AbortError";
};

const capabilitySnapshot = (
  provider: AnyProvider,
): { readonly values: readonly string[]; readonly valid: boolean } => {
  const raw = provider.capabilities as unknown;
  if (!Array.isArray(raw)) return { values: [], valid: false };

  const valid = raw.every(
    (value): value is string => typeof value === "string",
  );
  return {
    values: raw.map((value) =>
      typeof value === "string" ? value : "<invalid-capability>",
    ),
    valid,
  };
};

const sameCapabilitySet = (
  expected: readonly string[],
  actual: readonly string[],
): boolean => {
  if (expected.length !== actual.length) return false;
  const expectedSorted = [...expected].sort();
  const actualSorted = [...actual].sort();
  return expectedSorted.every(
    (capability, index) => capability === actualSorted[index],
  );
};

const provenanceFor = (plan: RunPlan): ExecutionProvenance => ({
  schemaVersion: plan.schemaVersion,
  workUri: plan.work.uri,
  workRevision: plan.work.snapshot.revision,
  workSource: plan.work.snapshot.provenance.source,
  workSourceRevision: plan.work.snapshot.provenance.revision,
  inputSource: plan.inputProvenance.source,
  inputRevision: plan.inputProvenance.revision,
  planCreatedAt: plan.createdAt,
});

export function preflightProviderRegistry(
  plan: RunPlan,
  providers: ProviderRegistry,
): readonly ExecutionPreflightIssue[] {
  const registry = providers as Partial<Record<ProviderKind, AnyProvider>>;
  const issues: ExecutionPreflightIssue[] = [];

  for (const kind of PROVIDER_KINDS) {
    const expected = plan.providers[kind];
    const actual = registry[kind];
    if (!actual) {
      issues.push({
        code: "provider_missing",
        path: ["providers", kind],
        providerKind: kind,
        providerId: expected.id,
        field: "provider",
        expected: expected.id,
        actual: null,
      });
      continue;
    }

    const actualId = typeof actual.id === "string" ? actual.id : null;
    const actualKind = typeof actual.kind === "string" ? actual.kind : null;
    const actualVersion =
      typeof actual.version === "string" ? actual.version : null;
    const actualCapabilities = capabilitySnapshot(actual);

    if (actualKind !== kind) {
      issues.push({
        code: "provider_kind_mismatch",
        path: ["providers", kind, "kind"],
        providerKind: kind,
        providerId: actualId ?? expected.id,
        field: "kind",
        expected: kind,
        actual: actualKind,
      });
    }
    if (actualId !== expected.id) {
      issues.push({
        code: "provider_id_mismatch",
        path: ["providers", kind, "id"],
        providerKind: kind,
        providerId: actualId ?? expected.id,
        field: "id",
        expected: expected.id,
        actual: actualId,
      });
    }
    if (actualVersion !== expected.version) {
      issues.push({
        code: "provider_version_mismatch",
        path: ["providers", kind, "version"],
        providerKind: kind,
        providerId: actualId ?? expected.id,
        field: "version",
        expected: expected.version,
        actual: actualVersion,
      });
    }
    if (
      !actualCapabilities.valid ||
      !sameCapabilitySet(expected.capabilities, actualCapabilities.values)
    ) {
      issues.push({
        code: "provider_capability_drift",
        path: ["providers", kind, "capabilities"],
        providerKind: kind,
        providerId: actualId ?? expected.id,
        field: "capabilities",
        expected: expected.capabilities,
        actual: actualCapabilities.values,
      });
    }

    for (const [index, capability] of plan.requiredCapabilities[
      kind
    ].entries()) {
      if (actualCapabilities.values.includes(capability)) continue;
      issues.push({
        code: "unsupported_capability",
        path: ["requiredCapabilities", kind, index],
        providerKind: kind,
        providerId: actualId ?? expected.id,
        field: "requiredCapabilities",
        expected: capability,
        actual: actualCapabilities.values,
        capability,
      });
    }
  }

  return issues;
}

const cancellationFailure = (
  error?: ProviderError,
): CancelledExecutionFailure => ({
  code: "cancelled",
  ...(error ? { provider: error.toJSON() } : {}),
});

const failureFromError = (
  error: unknown,
  signal: AbortSignal,
): {
  readonly outcome: "failed" | "cancelled";
  readonly failure: FailedExecutionFailure | CancelledExecutionFailure;
} => {
  if (error instanceof ProviderError) {
    if (signal.aborted || error.code === "cancelled") {
      return { outcome: "cancelled", failure: cancellationFailure(error) };
    }
    return { outcome: "failed", failure: error.toJSON() };
  }
  if (signal.aborted || isAbortLike(error)) {
    return { outcome: "cancelled", failure: cancellationFailure() };
  }
  return { outcome: "failed", failure: { code: "engine_failed" } };
};

const cleanupFailureFromError = (error: unknown): CleanupFailure =>
  error instanceof ProviderError ? error.toJSON() : { code: "cleanup_failed" };

const isCleanupFailure = (outcome: CleanupOutcome): boolean =>
  outcome.status === "failed";

export async function executeRunPlan(
  plan: RunPlan,
  providers: ProviderRegistry,
  task: ExecutionTask,
  {
    signal = new AbortController().signal,
    onEvent,
    now = () => new Date(),
  }: ExecuteRunPlanOptions = {},
): Promise<ExecutionResult> {
  const provenance = provenanceFor(plan);
  const completedPhases: ExecutionPhase[] = [];
  const cleanups: ExecutionCleanup[] = [];
  let cleanupStarted = false;

  const emit = (
    phase: ExecutionPhase,
    details: Pick<ExecutionEvent, "outcome" | "failure" | "cleanup"> = {},
  ): void => {
    completedPhases.push(phase);
    try {
      onEvent?.(
        deepFreeze({
          event: "execution.phase",
          phase,
          at: now().toISOString(),
          provenance,
          ...details,
        }) as ExecutionEvent,
      );
    } catch {
      // Observation must never change the operational outcome.
    }
  };

  const invokeFor =
    (operationSignal: AbortSignal): InvokeProvider =>
    async <K extends ProviderKind, O extends OperationName<K>>(
      kind: K,
      operation: O,
      input: OperationInput<K, O>,
    ): Promise<OperationResult<K, O>> => {
      const provider = providers[kind];
      return invokeProviderOperation(provider, operation, input, {
        signal: operationSignal,
      });
    };

  const executionInvoke = invokeFor(signal);
  const cleanupController = new AbortController();
  const cleanupInvoke = invokeFor(cleanupController.signal);

  emit("preflight");

  let primaryOutcome: ExecutionOutcome = "succeeded";
  let primaryFailure:
    | FailedExecutionFailure
    | CancelledExecutionFailure
    | null = null;

  if (signal.aborted) {
    primaryOutcome = "cancelled";
    primaryFailure = cancellationFailure();
  } else {
    const preflightIssues = preflightProviderRegistry(plan, providers);
    if (preflightIssues.length > 0) {
      primaryOutcome = "failed";
      primaryFailure = {
        code: "preflight_failed",
        issues: preflightIssues,
      };
    } else {
      emit("running");
      const context: ExecutionContext = {
        plan,
        providers,
        signal,
        now,
        invoke: executionInvoke,
        registerCleanup: (cleanup) => {
          if (cleanupStarted) {
            throw new Error("cleanup_registration_closed");
          }
          cleanups.push(cleanup);
        },
      };

      try {
        await task(context);
        if (signal.aborted) {
          primaryOutcome = "cancelled";
          primaryFailure = cancellationFailure();
        }
      } catch (error) {
        const normalized = failureFromError(error, signal);
        primaryOutcome = normalized.outcome;
        primaryFailure = normalized.failure;
      }
    }
  }

  cleanupStarted = true;
  emit("cleanup");
  const cleanupOutcomes: CleanupOutcome[] = [];
  const cleanupContext: ExecutionCleanupContext = {
    plan,
    providers,
    signal: cleanupController.signal,
    now,
    invoke: cleanupInvoke,
  };

  for (const [reverseIndex, cleanup] of [...cleanups].reverse().entries()) {
    const index = cleanups.length - reverseIndex - 1;
    try {
      await cleanup(cleanupContext);
      cleanupOutcomes.push({ index, status: "succeeded" });
    } catch (error) {
      cleanupOutcomes.push({
        index,
        status: "failed",
        failure: cleanupFailureFromError(error),
      });
    }
  }

  const cleanup: CleanupResult = { outcomes: cleanupOutcomes };
  const cleanupFailed = cleanupOutcomes.some(isCleanupFailure);
  let outcome = primaryOutcome;
  let failure = primaryFailure;

  if (outcome === "succeeded" && cleanupFailed) {
    outcome = "failed";
    failure = { code: "cleanup_failed" };
  }

  emit("terminal", { outcome, failure, cleanup });
  const resultBase = {
    provenance,
    completedPhases: [...completedPhases],
    cleanup,
  };

  if (outcome === "succeeded") {
    return deepFreeze({
      ...resultBase,
      outcome,
      failure: null,
    }) as ExecutionResult;
  }
  if (outcome === "cancelled") {
    return deepFreeze({
      ...resultBase,
      outcome,
      failure: failure as CancelledExecutionFailure,
    }) as ExecutionResult;
  }
  return deepFreeze({
    ...resultBase,
    outcome,
    failure: failure as FailedExecutionFailure,
  }) as ExecutionResult;
}
