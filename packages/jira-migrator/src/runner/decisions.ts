import { fingerprintJiraState } from "../execution/diff.js";
import type { JiraChangelogPlan } from "../issues/changelog.js";
import type {
  JiraIssueDeferredItem,
  JiraIssueImportPlan,
} from "../issues/importPlan.js";
import {
  type JiraMigrationAction,
  type JiraMigrationEntityResult,
  type JiraMigrationLedgerV1,
  jiraIssueSourceIdentity,
} from "../ledger.js";
import type { NormalizedJiraIssue } from "../payloads.js";
import type {
  JiraPlanningAction,
  JiraPlanningTargetResolution,
} from "../planning/entities.js";
import type { JiraRelatedImportReport } from "../related/import.js";

type JiraMigrationBinding = JiraMigrationLedgerV1["bindings"][number];

export const inferRelationSourceProjectKey = (input: {
  binding: JiraMigrationBinding;
  ledger: JiraMigrationLedgerV1;
  currentIssues: readonly NormalizedJiraIssue[];
  configuredProjectKeys: readonly string[];
  projectKeyById: ReadonlyMap<string, string>;
}): string | undefined => {
  const { binding } = input;
  if (binding.source_identity.entity_kind !== "relation") return undefined;
  const relationIdentity = binding.source_identity;
  if (relationIdentity.source_project_key) {
    return relationIdentity.source_project_key;
  }
  const sourceIssue = input.currentIssues.find(
    (issue) =>
      issue.id === relationIdentity.source_issue_id ||
      issue.key === relationIdentity.source_issue_id,
  );
  if (sourceIssue) {
    return (
      sourceIssue.projectKey ??
      input.projectKeyById.get(projectId(sourceIssue)) ??
      sourceIssue.key.split("-")[0]
    );
  }
  const projectKeyFromIssueKey = [...input.configuredProjectKeys]
    .sort((left, right) => right.length - left.length)
    .find((key) => relationIdentity.source_issue_id.startsWith(`${key}-`));
  if (projectKeyFromIssueKey) return projectKeyFromIssueKey;
  const issueBinding = input.ledger.bindings.find(
    (candidate) =>
      candidate.source_identity.entity_kind === "issue" &&
      candidate.source_identity.jira_cloud_id ===
        relationIdentity.jira_cloud_id &&
      candidate.source_identity.issue_id === relationIdentity.source_issue_id,
  );
  return issueBinding?.source_identity.entity_kind === "issue"
    ? input.projectKeyById.get(issueBinding.source_identity.project_id)
    : undefined;
};

export const reconciliationAction = (
  item: JiraIssueDeferredItem,
  relatedReport: JiraRelatedImportReport | undefined,
  planningResolutions: readonly JiraPlanningTargetResolution[],
): "skip" | "conflict" | "failed" => {
  if (item.kind === "release" || item.kind === "sprint") {
    if (item.reason === "owner_decision_required") return "conflict";
    return planningResolutions.some(
      (resolution) =>
        resolution.sourceIdentity.key === item.sourceKey &&
        resolution.targetKind === item.kind,
    )
      ? "skip"
      : "conflict";
  }
  if (item.kind === "parent") return "conflict";
  if (!relatedReport) return "conflict";
  const sourceKind = item.kind === "relation" ? "link" : "media";
  if (
    relatedReport.failures.some((failure) => failure.source_kind === sourceKind)
  ) {
    return "failed";
  }
  if (item.kind === "relation") {
    return relatedReport.links.unique > 0 &&
      relatedReport.links.unresolved === 0
      ? "skip"
      : "conflict";
  }
  return relatedReport.media.total > 0 && relatedReport.media.unresolved === 0
    ? "skip"
    : "conflict";
};

export const projectId = (issue: NormalizedJiraIssue): string =>
  String(issue.raw.fields.project?.id ?? issue.projectKey ?? "unknown");

export const mappedFingerprintForChangelog = (
  plan: JiraChangelogPlan,
): string =>
  fingerprintJiraState({
    report: plan.report,
    items: plan.items,
  });

export const legacyMappedFingerprintForChangelog = (
  plan: JiraChangelogPlan,
): string => fingerprintJiraState(plan.report);

export const actionForChangelogPlan = (
  plan: JiraChangelogPlan,
  ledger: JiraMigrationLedgerV1,
): "create" | "skip" | "conflict" => {
  if (plan.report.totals.failed > 0) return "conflict";
  const binding = ledger.bindings.find(
    (candidate) => candidate.source_key === plan.sourceIdentity.key,
  );
  return binding?.source_fingerprint === plan.sourceFingerprint &&
    binding.mapped_state_fingerprint === mappedFingerprintForChangelog(plan)
    ? "skip"
    : "create";
};

export const safeMigrationFailureReason = (
  error: unknown,
  fallback: string,
): string => {
  if (
    error instanceof Error &&
    /^[a-z][a-z0-9_.:-]{2,127}$/u.test(error.message)
  ) {
    return error.message;
  }
  return fallback;
};

export const resultFor = (input: {
  sourceKey: string;
  entityKind: JiraMigrationEntityResult["entity_kind"];
  sourceFingerprint: string;
  mappedFingerprint: string;
  action: JiraMigrationAction;
  at: string;
  readback: boolean;
  retryable?: boolean;
  reconciliationState?: JiraMigrationEntityResult["reconciliation_state"];
}): JiraMigrationEntityResult => ({
  source_key: input.sourceKey,
  entity_kind: input.entityKind,
  source_fingerprint: input.sourceFingerprint,
  mapped_state_fingerprint: input.mappedFingerprint,
  action: input.action,
  retryable: input.retryable ?? false,
  error_code: input.action === "failed" ? "target_write_failed" : null,
  attempted_at: input.at,
  readback_at: input.readback ? input.at : null,
  reconciliation_state: input.reconciliationState ?? "not_applicable",
});

export const actionForPlanning = (
  classification: JiraPlanningAction["classification"],
): JiraMigrationAction => {
  if (classification === "create") return "create";
  if (classification === "reuse") return "skip";
  return "conflict";
};

export const actionForIssuePlan = (
  plan: JiraIssueImportPlan,
  ledger: JiraMigrationLedgerV1,
): "create" | "update" | "skip" | "conflict" => {
  if (!plan.desired.issue || plan.status === "blocked") return "conflict";
  const identity = jiraIssueSourceIdentity(
    plan.source.jiraCloudId,
    plan.source.projectId ?? plan.source.projectKey,
    plan.source.issueId,
  );
  const binding = ledger.bindings.find(
    (candidate) => candidate.source_key === identity.key,
  );
  if (!binding) return "create";
  if (
    binding.target.target_kind !== "issue" ||
    binding.target.reef_id !== plan.desired.issue.id
  ) {
    return "conflict";
  }
  return binding.mapped_state_fingerprint === fingerprintJiraState(plan.desired)
    ? "skip"
    : "update";
};

export const actionForRelatedReport = (
  report: JiraRelatedImportReport,
): "create" | "update" | "skip" | "failed" => {
  if (report.failures.length > 0) return "failed";
  if (
    report.comments.created +
      report.attachments.created +
      report.links.applied +
      report.remote_links.applied >
    0
  ) {
    return "create";
  }
  return report.comments.updated + report.deletions > 0 ||
    report.media.description_updated
    ? "update"
    : "skip";
};

export const mergePlanningActions = (
  actions: readonly JiraPlanningAction[],
): JiraPlanningAction[] => {
  const bySource = new Map<string, JiraPlanningAction>();
  for (const action of actions) {
    const current = bySource.get(action.sourceIdentity.key);
    if (!current || current.classification !== "reuse") {
      bySource.set(action.sourceIdentity.key, action);
    }
  }
  const merged = [...bySource.values()];
  const names = new Map<string, JiraPlanningAction[]>();
  for (const action of merged) {
    if (!action.target) continue;
    const key = `${action.target.kind}:${action.target.item.name.trim().toLowerCase()}`;
    const group = names.get(key) ?? [];
    group.push(action);
    names.set(key, group);
  }
  return merged
    .map((action) => {
      if (!action.target || action.reason === "ledger_binding") return action;
      const key = `${action.target.kind}:${action.target.item.name.trim().toLowerCase()}`;
      const group = names.get(key) ?? [];
      if (new Set(group.map((item) => item.sourceIdentity.key)).size < 2) {
        return action;
      }
      return {
        ...action,
        classification: "conflict" as const,
        reason: "planning_conflict" as const,
        targetId: null,
        report: [
          ...action.report,
          {
            field: "name",
            outcome: "conflict" as const,
            reason: "multiple source identities share one target name",
          },
        ],
      };
    })
    .sort((left, right) =>
      left.sourceIdentity.key.localeCompare(right.sourceIdentity.key),
    );
};
