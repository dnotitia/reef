import { randomUUID } from "node:crypto";
import {
  ControllerError,
  type ControllerInspection,
  type ControllerState,
  type ControllerStore,
  DuplicateWorkError,
  createControllerStore,
} from "@reef/orchestration-controller";
import {
  type ExecutionEvent,
  type ExecutionPhase,
  type ExecutionResult,
  ProviderError,
  type RunPlan,
  type WorkSnapshot,
  executeRunPlan,
  installShutdownHandlers,
  parseRunPlan,
  preflightProviderRegistry,
} from "@reef/orchestrator";
import { parseReefWorkUri } from "@reef/work-provider-reef";
import {
  type CliConfig,
  CliConfigError,
  type ParsedCliConfig,
  providerConfigFor,
} from "./config.js";
import {
  CliUsageError,
  type InvocationArguments,
  type ParsedArguments,
  parseInvocationArguments,
  readInvocationConfig,
} from "./parser.js";
import {
  type CliEnvironment,
  CliResolutionError,
  resolveProviders,
} from "./providers.js";
import {
  type TerminalFailure,
  type TerminalResult,
  exitCodeForOutcome,
  planSummary,
  progressFromExecution,
  safeFailure,
  terminalFromExecution,
} from "./result.js";

export interface CliRunnerDependencies {
  readonly environment?: CliEnvironment;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
  readonly onEvent?: (event: ReturnType<typeof progressFromExecution>) => void;
  readonly createStore?: (
    config: CliConfig,
    redactionValues: readonly string[],
  ) => ControllerStore;
}

export interface CliRunResult {
  readonly terminal: TerminalResult;
  readonly exitCode: number;
}

class CliWorkError extends Error {
  readonly code = "work_invalid" as const;
  readonly path = ["work_uri"] as const;

  constructor() {
    super("work_invalid");
    this.name = "CliWorkError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const phaseOrder: readonly ExecutionPhase[] = [
  "preflight",
  "running",
  "cleanup",
  "terminal",
];

const defaultNow = (): Date => new Date();

const outcomeForFailure = (
  runId: string,
  workUri: string | null,
  code: string,
  path: readonly (string | number)[] | undefined,
  plan: RunPlan | null = null,
  controller: TerminalResult["controller"] = null,
  exitCode = 2,
): CliRunResult => {
  const terminal: TerminalResult = {
    schema_version: 1,
    run_id: runId,
    work_uri: workUri,
    outcome: "failed",
    plan: plan ? planSummary(plan) : null,
    artifact_refs: [],
    cleanup: { outcomes: [] },
    failure: safeFailure(undefined, code, path),
    controller,
    next_actions: ["delivery_handoff_not_started"],
  };
  return { terminal, exitCode };
};

const cancelledBeforeClaim = (
  runId: string,
  workUri: string | null,
  plan: RunPlan | null,
): CliRunResult => {
  const terminal: TerminalResult = {
    schema_version: 1,
    run_id: runId,
    work_uri: workUri,
    outcome: "cancelled",
    plan: plan ? planSummary(plan) : null,
    artifact_refs: [],
    cleanup: { outcomes: [] },
    failure: { code: "cancelled" },
    controller: null,
    next_actions: ["delivery_handoff_not_started"],
  };
  return { terminal, exitCode: 130 };
};

const providerFailure = (
  error: ProviderError,
  code: string,
  path: readonly (string | number)[],
): TerminalFailure => ({
  code,
  path: [...path],
  provider: {
    kind: error.providerKind,
    id: error.providerId,
    operation: error.operation,
    ...(error.capability ? { capability: error.capability } : {}),
  },
});

const controllerInfo = (
  inspection: ControllerInspection | null,
  existingRun: DuplicateWorkError["existingRun"],
): TerminalResult["controller"] => ({
  ...(inspection?.classification
    ? { classification: inspection.classification }
    : {}),
  ...(inspection?.liveness ? { liveness: inspection.liveness } : {}),
  allowed_actions: inspection?.allowedActions
    ? [...inspection.allowedActions]
    : [],
  existing_run: {
    run_id: existingRun.runId,
    work_uri: existingRun.workUri,
    phase: existingRun.phase,
    revision: existingRun.revision,
    started_at: existingRun.startedAt,
    updated_at: existingRun.updatedAt,
  },
});

const blockedResult = async (
  runId: string,
  workUri: string,
  plan: RunPlan,
  store: ControllerStore,
  error: DuplicateWorkError,
): Promise<CliRunResult> => {
  let inspection: ControllerInspection | null = null;
  try {
    inspection = await store.inspect(workUri);
  } catch {
    inspection = null;
  }
  const allowed = inspection?.allowedActions ?? [];
  const nextAction = allowed.includes("cleanup")
    ? "controller_cleanup_allowed"
    : allowed.includes("update")
      ? "existing_run_must_finish"
      : "controller_state_requires_owner";
  const terminal: TerminalResult = {
    schema_version: 1,
    run_id: runId,
    work_uri: workUri,
    outcome: "blocked",
    plan: planSummary(plan),
    artifact_refs: [],
    cleanup: { outcomes: [] },
    failure: { code: "duplicate_work", path: ["work_uri"] },
    controller: controllerInfo(inspection, error.existingRun),
    next_actions: [nextAction, "delivery_handoff_not_started"],
  };
  return { terminal, exitCode: 3 };
};

const buildPlan = (
  workUri: string,
  snapshot: WorkSnapshot,
  config: CliConfig,
  configDigest: string,
  providers: ReturnType<typeof resolveProviders>,
  now: () => Date,
): RunPlan => {
  const createdAt = now().toISOString();
  return parseRunPlan({
    schemaVersion: 1,
    work: {
      uri: workUri,
      snapshot: {
        revision: snapshot.revision,
        provenance: { ...snapshot.provenance },
      },
    },
    providers: {
      work: {
        kind: providers.providers.work.kind,
        id: providers.providers.work.id,
        version: providers.providers.work.version,
        capabilities: [...providers.providers.work.capabilities],
      },
      harness: {
        kind: providers.providers.harness.kind,
        id: providers.providers.harness.id,
        version: providers.providers.harness.version,
        capabilities: [...providers.providers.harness.capabilities],
      },
      infrastructure: {
        kind: providers.providers.infrastructure.kind,
        id: providers.providers.infrastructure.id,
        version: providers.providers.infrastructure.version,
        capabilities: [...providers.providers.infrastructure.capabilities],
      },
      scm: {
        kind: providers.providers.scm.kind,
        id: providers.providers.scm.id,
        version: providers.providers.scm.version,
        capabilities: [...providers.providers.scm.capabilities],
      },
      validation: {
        kind: providers.providers.validation.kind,
        id: providers.providers.validation.id,
        version: providers.providers.validation.version,
        capabilities: [...providers.providers.validation.capabilities],
      },
    },
    validationChecks: config.validation_checks.map((check) => ({
      name: check.name,
      command: check.command,
      timeoutMs: check.timeout_ms,
    })),
    requiredCapabilities: providers.requiredCapabilities,
    createdAt,
    inputProvenance: {
      source: "orchestration-cli:config",
      revision: configDigest,
    },
  });
};

const waitForRunWindow = async (
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> => {
  if (signal.aborted) throw new DOMException("cancelled", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("cancelled", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    timer.unref?.();
  });
};

const isTerminalControllerError = (error: unknown): error is ControllerError =>
  error instanceof ControllerError;

const isCancelledProviderError = (error: unknown): error is ProviderError =>
  error instanceof ProviderError && error.code === "cancelled";

const readWork = async (
  runId: string,
  workUri: string,
  providers: ReturnType<typeof resolveProviders>,
  signal: AbortSignal,
): Promise<WorkSnapshot> => {
  try {
    return await providers.providers.work.read(
      { uri: workUri },
      { signal, correlationId: runId },
    );
  } catch (error) {
    if (isCancelledProviderError(error)) throw error;
    if (error instanceof ProviderError) {
      throw providerFailure(error, "work_read_failed", ["work_uri"]);
    }
    throw new Error("work_read_failed");
  }
};

const updateControllerPhases = (
  store: ControllerStore,
  runId: string,
  initialRevision: number,
  onEvent: (event: ExecutionEvent) => void,
) => {
  let revision = initialRevision;
  let phaseIndex = -1;
  let queue = Promise.resolve();
  const sink = (event: ExecutionEvent): void => {
    onEvent(event);
    if (event.phase === "terminal") return;
    const nextIndex = phaseOrder.indexOf(event.phase);
    if (nextIndex <= phaseIndex) return;
    phaseIndex = nextIndex;
    queue = queue.then(async () => {
      const state = await store.update({
        runId,
        expectedRevision: revision,
        operation: { type: "phase", phase: event.phase },
      });
      revision = state.revision;
    });
  };
  return {
    sink,
    wait: async () => queue,
    revision: () => revision,
  };
};

const createDefaultStore = (
  config: CliConfig,
  redactionValues: readonly string[],
): ControllerStore =>
  createControllerStore({
    stateRoot: config.controller.state_root,
    staleAfterMs: config.controller.stale_after_ms,
    redactionValues,
  });

const runParsedInvocation = async (
  invocation: InvocationArguments,
  runId: string,
  dependencies: CliRunnerDependencies,
): Promise<CliRunResult> => {
  const now = dependencies.now ?? defaultNow;
  const signal = dependencies.signal ?? new AbortController().signal;
  let parsedConfig: ParsedCliConfig;
  try {
    parsedConfig = await readInvocationConfig(invocation);
  } catch (error) {
    if (error instanceof CliConfigError) {
      return outcomeForFailure(
        runId,
        invocation.workUri,
        error.code,
        error.path,
      );
    }
    if (error instanceof CliUsageError) {
      return outcomeForFailure(
        runId,
        invocation.workUri,
        error.code,
        error.path,
      );
    }
    return outcomeForFailure(runId, invocation.workUri, "config_invalid", [
      "config",
    ]);
  }
  const { config, digest } = parsedConfig;

  try {
    const workConfig = providerConfigFor(config, "work");
    if (workConfig.kind !== "work") throw new CliWorkError();
    parseReefWorkUri(invocation.workUri, workConfig.options.vault);
  } catch {
    return outcomeForFailure(runId, invocation.workUri, "work_invalid", [
      "work_uri",
    ]);
  }

  if (signal.aborted)
    return cancelledBeforeClaim(runId, invocation.workUri, null);

  let resolved: ReturnType<typeof resolveProviders>;
  try {
    resolved = resolveProviders(config, dependencies.environment);
  } catch (error) {
    if (error instanceof CliResolutionError) {
      return outcomeForFailure(
        runId,
        invocation.workUri,
        error.code,
        error.path,
      );
    }
    if (error instanceof ProviderError) {
      return outcomeForFailure(
        runId,
        invocation.workUri,
        "provider_configuration",
        ["providers"],
      );
    }
    return outcomeForFailure(
      runId,
      invocation.workUri,
      "provider_configuration",
      ["providers"],
    );
  }

  let snapshot: WorkSnapshot;
  try {
    snapshot = await readWork(runId, invocation.workUri, resolved, signal);
  } catch (error) {
    if (isCancelledProviderError(error) || signal.aborted) {
      return cancelledBeforeClaim(runId, invocation.workUri, null);
    }
    if (isSafeFailure(error)) {
      const terminal: TerminalResult = {
        schema_version: 1,
        run_id: runId,
        work_uri: invocation.workUri,
        outcome: "failed",
        plan: null,
        artifact_refs: [],
        cleanup: { outcomes: [] },
        failure: error,
        controller: null,
        next_actions: ["delivery_handoff_not_started"],
      };
      return { terminal, exitCode: 1 };
    }
    return outcomeForFailure(
      runId,
      invocation.workUri,
      "work_read_failed",
      ["work_uri"],
      null,
      null,
      1,
    );
  }

  if (signal.aborted)
    return cancelledBeforeClaim(runId, invocation.workUri, null);

  let plan: RunPlan;
  try {
    plan = buildPlan(
      invocation.workUri,
      snapshot,
      config,
      digest,
      resolved,
      now,
    );
  } catch {
    return outcomeForFailure(runId, invocation.workUri, "plan_invalid", [
      "plan",
    ]);
  }

  if (preflightProviderRegistry(plan, resolved.providers).length > 0) {
    return outcomeForFailure(
      runId,
      invocation.workUri,
      "provider_preflight_failed",
      ["providers"],
      plan,
    );
  }

  const store = dependencies.createStore
    ? dependencies.createStore(config, resolved.redactionValues)
    : createDefaultStore(config, resolved.redactionValues);
  let claimed: ControllerState;
  try {
    claimed = await store.claim({ runId, plan });
  } catch (error) {
    if (error instanceof DuplicateWorkError) {
      return blockedResult(runId, invocation.workUri, plan, store, error);
    }
    if (isTerminalControllerError(error)) {
      return outcomeForFailure(
        runId,
        invocation.workUri,
        "controller_claim_failed",
        ["controller"],
        plan,
        null,
        1,
      );
    }
    return outcomeForFailure(
      runId,
      invocation.workUri,
      "controller_claim_failed",
      ["controller"],
      plan,
      null,
      1,
    );
  }

  const progressSink = dependencies.onEvent ?? (() => undefined);
  const bridge = updateControllerPhases(
    store,
    runId,
    claimed.revision,
    (event) => {
      progressSink(progressFromExecution(event));
    },
  );
  let execution: ExecutionResult;
  try {
    execution = await executeRunPlan(
      plan,
      resolved.providers,
      async ({ signal: runSignal }) => {
        await waitForRunWindow(config.execution.run_window_ms, runSignal);
      },
      {
        signal,
        now,
        onEvent: bridge.sink,
      },
    );
    await bridge.wait();
  } catch {
    try {
      await bridge.wait();
    } catch {
      // Preserve the primary failure below; controller errors are summarized.
    }
    return outcomeForFailure(
      runId,
      invocation.workUri,
      "controller_lifecycle_failed",
      ["controller"],
      plan,
      null,
      1,
    );
  }

  try {
    await store.update({
      runId,
      expectedRevision: bridge.revision(),
      operation: { type: "terminal", result: execution },
    });
  } catch {
    const terminal: TerminalResult = {
      ...terminalFromExecution(runId, plan, execution),
      outcome: "failed",
      failure: { code: "controller_terminal_failed", path: ["controller"] },
      next_actions: [
        "controller_state_requires_review",
        "delivery_handoff_not_started",
      ],
    };
    return { terminal, exitCode: 1 };
  }

  const terminal = terminalFromExecution(runId, plan, execution);
  return {
    terminal,
    exitCode:
      execution.failure && execution.failure.code === "preflight_failed"
        ? 2
        : exitCodeForOutcome(terminal.outcome),
  };
};

function isSafeFailure(value: unknown): value is TerminalFailure {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { code?: unknown }).code === "string" &&
      (value as { provider?: unknown }).provider !== undefined,
  );
}

export async function runCliInvocation(
  argv: readonly string[],
  dependencies: CliRunnerDependencies = {},
): Promise<CliRunResult | { readonly help: true }> {
  const runId = `run-${randomUUID()}`;
  let parsed: ParsedArguments;
  try {
    parsed = parseInvocationArguments(argv);
  } catch (error) {
    const path = error instanceof CliUsageError ? error.path : ["argv"];
    return outcomeForFailure(runId, null, "usage_invalid", path);
  }
  if ("help" in parsed) return parsed;
  return runParsedInvocation(parsed, runId, dependencies);
}

export function createTerminalFailure(
  runId: string,
  workUri: string | null,
  error: unknown,
): CliRunResult {
  if (error instanceof ProviderError) {
    const terminal: TerminalResult = {
      schema_version: 1,
      run_id: runId,
      work_uri: workUri,
      outcome: "failed",
      plan: null,
      artifact_refs: [],
      cleanup: { outcomes: [] },
      failure: providerFailure(error, "provider_failed", ["providers"]),
      controller: null,
      next_actions: ["delivery_handoff_not_started"],
    };
    return { terminal, exitCode: 1 };
  }
  return outcomeForFailure(
    runId,
    workUri,
    "execution_failed",
    ["execution"],
    null,
    null,
    1,
  );
}

export function shutdownController(): ReturnType<
  typeof installShutdownHandlers
> {
  return installShutdownHandlers();
}
