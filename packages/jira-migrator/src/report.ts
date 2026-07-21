import type {
  JiraMigrationAction,
  JiraMigrationEntityKind,
  JiraMigrationEntityResult,
  JiraMigrationLedgerV1,
  JiraMigrationPhase,
} from "./ledger.js";
import { JIRA_MIGRATION_PHASES, JiraMigrationLedgerError } from "./ledger.js";

export interface JiraMigrationReportCounts {
  created: number;
  updated: number;
  skipped: number;
  conflict: number;
  failed: number;
  retryable: number;
}

const emptyCounts = (): JiraMigrationReportCounts => ({
  created: 0,
  updated: 0,
  skipped: 0,
  conflict: 0,
  failed: 0,
  retryable: 0,
});

const add = (
  counts: JiraMigrationReportCounts,
  result: JiraMigrationEntityResult,
): void => {
  const actionToCount: Partial<
    Record<JiraMigrationAction, keyof JiraMigrationReportCounts>
  > = {
    create: "created",
    update: "updated",
    skip: "skipped",
    conflict: "conflict",
    failed: "failed",
  };
  const field = actionToCount[result.action];
  if (field) counts[field] += 1;
  if (result.retryable) counts.retryable += 1;
};

export const buildJiraMigrationReport = (
  ledger: JiraMigrationLedgerV1,
  runId: string,
) => {
  const run = ledger.runs.find((item) => item.run_id === runId);
  if (!run) throw new JiraMigrationLedgerError("run_not_found");
  const totals = emptyCounts();
  const by_phase = Object.fromEntries(
    JIRA_MIGRATION_PHASES.map((phase) => {
      const by_entity_kind = {} as Partial<
        Record<JiraMigrationEntityKind, JiraMigrationReportCounts>
      >;
      for (const result of run.phases[phase].entities) {
        add(totals, result);
        const counts = by_entity_kind[result.entity_kind] ?? emptyCounts();
        add(counts, result);
        by_entity_kind[result.entity_kind] = counts;
      }
      return [phase, { status: run.phases[phase].status, by_entity_kind }];
    }),
  ) as Record<
    JiraMigrationPhase,
    {
      status: (typeof run.phases)[JiraMigrationPhase]["status"];
      by_entity_kind: Partial<
        Record<JiraMigrationEntityKind, JiraMigrationReportCounts>
      >;
    }
  >;
  return {
    run_id: run.run_id,
    project_keys: [...run.project_keys],
    totals,
    by_phase,
  };
};
