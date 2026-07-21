import { deepFreeze } from "./customFields.js";
import {
  type JiraMigrationEntityResult,
  JiraMigrationEntityResultSchema,
  JiraMigrationLedgerError,
  type JiraMigrationLedgerV1,
  JiraMigrationLedgerV1Schema,
  type JiraMigrationPhase,
} from "./ledger.js";

const phaseStatus = (
  entities: readonly JiraMigrationEntityResult[],
): "running" | "partial_failed" | "blocked" => {
  if (
    entities.some(
      (entity) =>
        entity.action === "conflict" ||
        (entity.action === "failed" && !entity.retryable),
    )
  ) {
    return "blocked";
  }
  if (entities.some((entity) => entity.action === "failed")) {
    return "partial_failed";
  }
  return "running";
};

const isResumableResult = (result: JiraMigrationEntityResult): boolean => {
  if (result.action === "failed") return result.retryable;
  if (result.action === "conflict") return false;
  if (
    result.reconciliation_state === "pending_target_migration" ||
    result.reconciliation_state === "ready"
  ) {
    return true;
  }
  return result.readback_at === null;
};

export const recordJiraMigrationResult = (
  ledger: JiraMigrationLedgerV1,
  input: {
    runId: string;
    phase: JiraMigrationPhase;
    result: JiraMigrationEntityResult;
  },
): JiraMigrationLedgerV1 => {
  const parsed = JiraMigrationEntityResultSchema.parse(input.result);
  let found = false;
  const runs = ledger.runs.map((run) => {
    if (run.run_id !== input.runId) return run;
    found = true;
    const current = run.phases[input.phase];
    const entities = current.entities
      .filter((entity) => entity.source_key !== parsed.source_key)
      .concat(parsed)
      .sort((left, right) => left.source_key.localeCompare(right.source_key));
    return {
      ...run,
      updated_at: parsed.attempted_at,
      phases: {
        ...run.phases,
        [input.phase]: { status: phaseStatus(entities), entities },
      },
    };
  });
  if (!found) throw new JiraMigrationLedgerError("run_not_found");
  return deepFreeze(JiraMigrationLedgerV1Schema.parse({ ...ledger, runs }));
};

export const finalizeJiraMigrationPhase = (
  ledger: JiraMigrationLedgerV1,
  input: { runId: string; phase: JiraMigrationPhase; at: string },
): JiraMigrationLedgerV1 => {
  let found = false;
  const runs = ledger.runs.map((run) => {
    if (run.run_id !== input.runId) return run;
    found = true;
    const current = run.phases[input.phase];
    const status = phaseStatus(current.entities);
    const hasResumableWork = current.entities.some(isResumableResult);
    return {
      ...run,
      updated_at: input.at,
      phases: {
        ...run.phases,
        [input.phase]: {
          ...current,
          status:
            status === "running" && !hasResumableWork ? "completed" : status,
        },
      },
    };
  });
  if (!found) throw new JiraMigrationLedgerError("run_not_found");
  return deepFreeze(JiraMigrationLedgerV1Schema.parse({ ...ledger, runs }));
};

export const resumableJiraMigrationEntities = (
  ledger: JiraMigrationLedgerV1,
  runId: string,
  phase: JiraMigrationPhase,
  sourceKeys: readonly string[],
): string[] => {
  const run = ledger.runs.find((item) => item.run_id === runId);
  if (!run) throw new JiraMigrationLedgerError("run_not_found");
  const results = new Map(
    run.phases[phase].entities.map((entity) => [entity.source_key, entity]),
  );
  return [...new Set(sourceKeys)]
    .filter((sourceKey) => {
      const result = results.get(sourceKey);
      if (!result) return true;
      return isResumableResult(result);
    })
    .sort();
};
