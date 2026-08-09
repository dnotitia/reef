import {
  type CleanupFailure,
  type CleanupResult,
  type ExecutionEvent,
  type ExecutionResult,
  PROVIDER_KINDS,
  type ProviderArtifact,
  type ProviderErrorJson,
  type ProviderKind,
  type RunPlan,
} from "@reef/orchestrator";
import { z } from "zod";

const providerKind = z.enum(PROVIDER_KINDS);

const providerFailure = z.strictObject({
  code: z.string().min(1),
  path: z
    .array(z.union([z.string(), z.number().int().nonnegative()]))
    .optional(),
  provider: z
    .strictObject({
      kind: providerKind,
      id: z.string().min(1),
      operation: z.string().min(1),
      capability: z.string().min(1).optional(),
    })
    .optional(),
});

const artifact = z.strictObject({
  kind: z.enum(["branch", "commit", "file", "proof", "pull_request", "report"]),
  ref: z.string().min(1),
  uri: z.string().url().optional(),
  title: z.string().optional(),
});

const cleanupOutcome = z.strictObject({
  index: z.number().int().nonnegative(),
  status: z.enum(["succeeded", "failed"]),
  failure: providerFailure.optional(),
});

export const TerminalPlanSummarySchema = z.strictObject({
  schema_version: z.literal(1),
  work: z.strictObject({
    uri: z.string().min(1),
    revision: z.string().min(1),
    provenance: z.strictObject({
      source: z.string().min(1),
      revision: z.string().min(1),
    }),
  }),
  providers: z.strictObject({
    work: z.strictObject({
      id: z.string(),
      version: z.string(),
      capabilities: z.array(z.string()),
    }),
    harness: z.strictObject({
      id: z.string(),
      version: z.string(),
      capabilities: z.array(z.string()),
    }),
    infrastructure: z.strictObject({
      id: z.string(),
      version: z.string(),
      capabilities: z.array(z.string()),
    }),
    scm: z.strictObject({
      id: z.string(),
      version: z.string(),
      capabilities: z.array(z.string()),
    }),
    validation: z.strictObject({
      id: z.string(),
      version: z.string(),
      capabilities: z.array(z.string()),
    }),
  }),
  input_provenance: z.strictObject({
    source: z.string().min(1),
    revision: z.string().min(1),
  }),
});

export const TerminalResultSchema = z.strictObject({
  schema_version: z.literal(1),
  run_id: z.string().min(1),
  work_uri: z.string().min(1).nullable(),
  outcome: z.enum(["succeeded", "failed", "blocked", "cancelled"]),
  plan: TerminalPlanSummarySchema.nullable(),
  artifact_refs: z.array(artifact),
  cleanup: z.strictObject({ outcomes: z.array(cleanupOutcome) }),
  failure: providerFailure.nullable(),
  controller: z
    .strictObject({
      classification: z
        .enum(["active", "terminal", "interrupted", "stale"])
        .optional(),
      liveness: z.enum(["alive", "dead", "unknown", "released"]).optional(),
      allowed_actions: z.array(z.enum(["update", "cleanup"])),
      existing_run: z
        .strictObject({
          run_id: z.string(),
          work_uri: z.string(),
          phase: z.string(),
          revision: z.number().int().nonnegative(),
          started_at: z.string(),
          updated_at: z.string(),
        })
        .optional(),
    })
    .nullable(),
  next_actions: z.array(z.string().min(1)).min(1),
});

export type TerminalPlanSummary = z.output<typeof TerminalPlanSummarySchema>;
export type TerminalResult = z.output<typeof TerminalResultSchema>;
export type TerminalFailure = NonNullable<TerminalResult["failure"]>;

export const ProgressEventSchema = z.strictObject({
  schema_version: z.literal(1),
  event: z.literal("execution.phase"),
  phase: z.enum(["preflight", "running", "cleanup", "terminal"]),
  at: z.string().min(1),
  work_uri: z.string().min(1),
  outcome: z.enum(["succeeded", "failed", "blocked", "cancelled"]).optional(),
  failure: providerFailure.nullable().optional(),
  cleanup: z
    .strictObject({
      outcomes: z.array(cleanupOutcome),
    })
    .optional(),
});

export type ProgressEvent = z.output<typeof ProgressEventSchema>;

export function planSummary(plan: RunPlan): TerminalPlanSummary {
  return {
    schema_version: 1,
    work: {
      uri: plan.work.uri,
      revision: plan.work.snapshot.revision,
      provenance: {
        source: plan.work.snapshot.provenance.source,
        revision: plan.work.snapshot.provenance.revision,
      },
    },
    providers: Object.fromEntries(
      PROVIDER_KINDS.map((kind) => {
        const provider = plan.providers[kind];
        return [
          kind,
          {
            id: provider.id,
            version: provider.version,
            capabilities: [...provider.capabilities],
          },
        ];
      }),
    ) as TerminalPlanSummary["providers"],
    input_provenance: {
      source: plan.inputProvenance.source,
      revision: plan.inputProvenance.revision,
    },
  };
}

const providerFailureSummary = (
  failure: ProviderErrorJson,
): TerminalFailure => ({
  code: failure.code,
  provider: {
    kind: failure.providerKind,
    id: failure.providerId,
    operation: failure.operation,
    ...(failure.capability ? { capability: failure.capability } : {}),
  },
});

export function safeFailure(
  failure: unknown,
  fallbackCode: string,
  path?: readonly (string | number)[],
): TerminalFailure {
  if (isProviderErrorJson(failure)) {
    const summary = providerFailureSummary(failure);
    return path ? { ...summary, path: [...path] } : summary;
  }
  if (isSafeFailure(failure)) {
    const provider = isProviderErrorJson(failure.provider)
      ? providerFailureSummary(failure.provider).provider
      : failure.provider;
    return {
      code: failure.code,
      ...(failure.path ? { path: failure.path } : {}),
      ...(provider ? { provider } : {}),
    };
  }
  return {
    code: fallbackCode,
    ...(path ? { path: [...path] } : {}),
  };
}

function isProviderErrorJson(value: unknown): value is ProviderErrorJson {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProviderErrorJson>;
  return (
    candidate.name === "ProviderError" &&
    typeof candidate.code === "string" &&
    typeof candidate.providerKind === "string" &&
    typeof candidate.providerId === "string" &&
    typeof candidate.operation === "string"
  );
}

function isSafeFailure(value: unknown): value is TerminalFailure {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TerminalFailure>;
  return typeof candidate.code === "string";
}

function cleanupSummary(result: CleanupResult): TerminalResult["cleanup"] {
  return {
    outcomes: result.outcomes.map((outcome) => ({
      index: outcome.index,
      status: outcome.status,
      ...(outcome.failure
        ? { failure: safeFailure(outcome.failure, "cleanup_failed") }
        : {}),
    })),
  };
}

export function terminalFromExecution(
  runId: string,
  plan: RunPlan,
  result: ExecutionResult,
  artifacts: readonly ProviderArtifact[] = [],
  nextActions: readonly string[] = result.outcome === "succeeded"
    ? ["review_in_progress"]
    : result.outcome === "blocked"
      ? ["user_input_required", "delivery_handoff_not_started"]
      : ["delivery_handoff_not_started"],
): TerminalResult {
  return {
    schema_version: 1,
    run_id: runId,
    work_uri: plan.work.uri,
    outcome: result.outcome,
    plan: planSummary(plan),
    artifact_refs: [...dedupeArtifacts(artifacts)],
    cleanup: cleanupSummary(result.cleanup),
    failure: result.failure
      ? safeFailure(
          result.failure,
          result.outcome === "cancelled" ? "cancelled" : "execution_failed",
        )
      : null,
    controller: null,
    next_actions: [...nextActions],
  };
}

export function progressFromExecution(event: ExecutionEvent): ProgressEvent {
  return {
    schema_version: 1,
    event: "execution.phase",
    phase: event.phase,
    at: event.at,
    work_uri: event.provenance.workUri,
    ...(event.outcome ? { outcome: event.outcome } : {}),
    ...(event.failure
      ? { failure: safeFailure(event.failure, "execution_failed") }
      : {}),
    ...(event.cleanup ? { cleanup: cleanupSummary(event.cleanup) } : {}),
  };
}

export function dedupeArtifacts(
  artifacts: readonly ProviderArtifact[],
): readonly ProviderArtifact[] {
  const seen = new Set<string>();
  const result: ProviderArtifact[] = [];
  for (const artifact of artifacts) {
    const key = JSON.stringify([
      artifact.kind,
      artifact.ref,
      artifact.uri ?? null,
      artifact.title ?? null,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...artifact });
  }
  return result;
}

export function exitCodeForOutcome(outcome: TerminalResult["outcome"]): number {
  switch (outcome) {
    case "succeeded":
      return 0;
    case "blocked":
      return 3;
    case "cancelled":
      return 130;
    case "failed":
      return 1;
  }
}
