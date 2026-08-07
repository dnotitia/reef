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

const providerFailure = z
  .object({
    code: z.string().min(1),
    path: z
      .array(z.union([z.string(), z.number().int().nonnegative()]))
      .optional(),
    provider: z
      .object({
        kind: providerKind,
        id: z.string().min(1),
        operation: z.string().min(1),
        capability: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const artifact = z
  .object({
    kind: z.enum([
      "branch",
      "commit",
      "file",
      "proof",
      "pull_request",
      "report",
    ]),
    ref: z.string().min(1),
    uri: z.string().url().optional(),
    title: z.string().optional(),
  })
  .strict();

const cleanupOutcome = z
  .object({
    index: z.number().int().nonnegative(),
    status: z.enum(["succeeded", "failed"]),
    failure: providerFailure.optional(),
  })
  .strict();

export const TerminalPlanSummarySchema = z
  .object({
    schema_version: z.literal(1),
    work: z
      .object({
        uri: z.string().min(1),
        revision: z.string().min(1),
        provenance: z
          .object({
            source: z.string().min(1),
            revision: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    providers: z
      .object({
        work: z
          .object({
            id: z.string(),
            version: z.string(),
            capabilities: z.array(z.string()),
          })
          .strict(),
        harness: z
          .object({
            id: z.string(),
            version: z.string(),
            capabilities: z.array(z.string()),
          })
          .strict(),
        infrastructure: z
          .object({
            id: z.string(),
            version: z.string(),
            capabilities: z.array(z.string()),
          })
          .strict(),
        scm: z
          .object({
            id: z.string(),
            version: z.string(),
            capabilities: z.array(z.string()),
          })
          .strict(),
        validation: z
          .object({
            id: z.string(),
            version: z.string(),
            capabilities: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
    input_provenance: z
      .object({
        source: z.string().min(1),
        revision: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const TerminalResultSchema = z
  .object({
    schema_version: z.literal(1),
    run_id: z.string().min(1),
    work_uri: z.string().min(1).nullable(),
    outcome: z.enum(["succeeded", "failed", "blocked", "cancelled"]),
    plan: TerminalPlanSummarySchema.nullable(),
    artifact_refs: z.array(artifact),
    cleanup: z.object({ outcomes: z.array(cleanupOutcome) }).strict(),
    failure: providerFailure.nullable(),
    controller: z
      .object({
        classification: z
          .enum(["active", "terminal", "interrupted", "stale"])
          .optional(),
        liveness: z.enum(["alive", "dead", "unknown", "released"]).optional(),
        allowed_actions: z.array(z.enum(["update", "cleanup"])),
        existing_run: z
          .object({
            run_id: z.string(),
            work_uri: z.string(),
            phase: z.string(),
            revision: z.number().int().nonnegative(),
            started_at: z.string(),
            updated_at: z.string(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .nullable(),
    next_actions: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type TerminalPlanSummary = z.output<typeof TerminalPlanSummarySchema>;
export type TerminalResult = z.output<typeof TerminalResultSchema>;
export type TerminalFailure = NonNullable<TerminalResult["failure"]>;

export const ProgressEventSchema = z
  .object({
    schema_version: z.literal(1),
    event: z.literal("execution.phase"),
    phase: z.enum(["preflight", "running", "cleanup", "terminal"]),
    at: z.string().min(1),
    work_uri: z.string().min(1),
    outcome: z.enum(["succeeded", "failed", "cancelled"]).optional(),
    failure: providerFailure.nullable().optional(),
    cleanup: z
      .object({
        outcomes: z.array(cleanupOutcome),
      })
      .strict()
      .optional(),
  })
  .strict();

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
    return {
      code: failure.code,
      ...(failure.path ? { path: failure.path } : {}),
      ...(failure.provider ? { provider: failure.provider } : {}),
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
): TerminalResult {
  return {
    schema_version: 1,
    run_id: runId,
    work_uri: plan.work.uri,
    outcome: result.outcome,
    plan: planSummary(plan),
    artifact_refs: [],
    cleanup: cleanupSummary(result.cleanup),
    failure: result.failure
      ? safeFailure(
          result.failure,
          result.outcome === "cancelled" ? "cancelled" : "execution_failed",
        )
      : null,
    controller: null,
    next_actions: ["delivery_handoff_not_started"],
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
