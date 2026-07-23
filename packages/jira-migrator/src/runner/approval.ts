import { fingerprintJiraState } from "../execution/diff.js";
import type { JiraIssueImportPlan } from "../issues/importPlan.js";
import type { JiraMigrationLedgerV1 } from "../ledger.js";
import type {
  JiraPlanningAction,
  JiraPlanningTargetResolution,
} from "../planning/entities.js";
import type { JiraRelatedImportReport } from "../related/import.js";
import { jiraOwnerIdentity } from "./ownership.js";
import type { JiraRunnerReport } from "./report.js";
import type { AkbJiraMigrationTarget } from "./targetAdapter.js";

export const safePlanningAction = (action: JiraPlanningAction) => ({
  classification: action.classification,
  source_identity: action.sourceIdentity,
  selection: [...action.selection],
  source_fingerprint: fingerprintJiraState(action.provenance.source),
  target:
    action.target === null
      ? null
      : {
          kind: action.target.kind,
          name: action.target.item.name,
          state_fingerprint: fingerprintJiraState(action.target.item),
        },
  target_id: action.classification === "reuse" ? action.targetId : null,
});

export const planningSourceProjection = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const {
    classification: _classification,
    target_id: _targetId,
    ...source
  } = value as Record<string, unknown>;
  return source;
};

const semanticPlanningToken = (action: JiraPlanningAction): string =>
  action.target
    ? `jira-planning:${action.target.kind}:${action.target.item.name.trim().toLowerCase()}`
    : `jira-planning:unsupported:${action.sourceIdentity.key}`;

export const planningResolutionsForApproval = (
  actions: readonly JiraPlanningAction[],
): JiraPlanningTargetResolution[] =>
  actions.flatMap((action) =>
    action.classification === "conflict" ||
    action.classification === "unsupported"
      ? []
      : [
          {
            sourceIdentity: action.sourceIdentity,
            targetKind:
              action.sourceIdentity.kind === "version"
                ? ("release" as const)
                : ("sprint" as const),
            targetId: semanticPlanningToken(action),
          },
        ],
  );

export const semanticIssuePlan = (
  plan: JiraIssueImportPlan,
  resolutions: readonly JiraPlanningTargetResolution[],
  actions: readonly JiraPlanningAction[],
): unknown => {
  const actionsBySource = new Map(
    actions.map((action) => [action.sourceIdentity.key, action]),
  );
  const tokens = new Map(
    resolutions.map((resolution) => {
      const action = actionsBySource.get(resolution.sourceIdentity.key);
      return [
        resolution.targetId,
        action
          ? semanticPlanningToken(action)
          : `jira-planning:unknown:${resolution.sourceIdentity.key}`,
      ];
    }),
  );
  const desiredIssue = plan.desired.issue;
  return {
    source: plan.source,
    desired: {
      ...plan.desired,
      issue: desiredIssue
        ? {
            ...desiredIssue,
            release_id: desiredIssue.release_id
              ? (tokens.get(desiredIssue.release_id) ?? desiredIssue.release_id)
              : desiredIssue.release_id,
            sprint_id: desiredIssue.sprint_id
              ? (tokens.get(desiredIssue.sprint_id) ?? desiredIssue.sprint_id)
              : desiredIssue.sprint_id,
          }
        : null,
    },
    deferred: plan.deferred,
    field_results: plan.field_results,
    status: plan.status,
  };
};

export const semanticRelatedReport = (
  report: JiraRelatedImportReport,
): unknown => ({
  deletions: report.deletions,
  comments: {
    total: report.comments.total,
    roots: report.comments.roots,
    replies: report.comments.replies,
    flat_fallback: report.comments.flat_fallback,
  },
  attachments: {
    total: report.attachments.total,
    bytes: report.attachments.bytes,
  },
  media: {
    total: report.media.total,
    unresolved: report.media.unresolved,
    by_strategy: report.media.by_strategy,
  },
  links: {
    entries: report.links.entries,
    unique: report.links.unique,
    unresolved: report.links.unresolved,
  },
  remote_links: { total: report.remote_links.total },
  failures: report.failures,
});

export const approvalRelevantReport = (report: JiraRunnerReport): unknown => ({
  ...report,
  run: {
    ...report.run,
    started_at: null,
    ended_at: null,
  },
  approval: {
    ...report.approval,
    dry_run_completed_at: null,
  },
});

const issueReadbackApprovalState = (
  plan: JiraIssueImportPlan,
  readback: Awaited<ReturnType<AkbJiraMigrationTarget["readIssue"]>> | null,
): {
  desired: Record<string, unknown>;
  actual: Record<string, unknown>;
} | null => {
  const desired = plan.desired.issue;
  if (!desired || !readback || desired.source !== "jira-migration") return null;
  const downstreamManagedKeys = new Set([
    "external_refs",
    "depends_on",
    "blocks",
    "related_to",
    "created_at",
    "updated_at",
  ]);
  const keys = Object.keys(desired).filter(
    (key) => !downstreamManagedKeys.has(key),
  );
  const desiredCustomFields =
    desired.custom_fields &&
    typeof desired.custom_fields === "object" &&
    !Array.isArray(desired.custom_fields)
      ? (desired.custom_fields as Record<string, unknown>)
      : {};
  const ownedCustomFieldKeys = Object.keys(desiredCustomFields).filter(
    (key) => key !== "jira_migration",
  );
  const normalize = (
    issue: Record<string, unknown>,
  ): Record<string, unknown> => {
    const projection = Object.fromEntries(
      keys.map((key) => [key, issue[key] ?? null]),
    );
    const customFields =
      projection.custom_fields &&
      typeof projection.custom_fields === "object" &&
      !Array.isArray(projection.custom_fields)
        ? (projection.custom_fields as Record<string, unknown>)
        : null;
    const migration =
      customFields?.jira_migration &&
      typeof customFields.jira_migration === "object" &&
      !Array.isArray(customFields.jira_migration)
        ? (customFields.jira_migration as Record<string, unknown>)
        : null;
    if (!migration?.owner) return projection;
    projection.custom_fields = {
      ...Object.fromEntries(
        ownedCustomFieldKeys.map((key) => [key, customFields?.[key] ?? null]),
      ),
      jira_migration: { owner: migration.owner },
    };
    return projection;
  };
  return {
    desired: normalize(desired as Record<string, unknown>),
    actual: normalize(readback.issue as unknown as Record<string, unknown>),
  };
};

export const issueReadbackApprovalFingerprint = (
  plan: JiraIssueImportPlan,
  readback: Awaited<ReturnType<AkbJiraMigrationTarget["readIssue"]>> | null,
): string | null => {
  const state = issueReadbackApprovalState(plan, readback);
  return state
    ? fingerprintJiraState({
        issue: state.actual,
        content: readback?.content ?? "",
      })
    : null;
};

export const baseIssueReadbackMatches = (
  plan: JiraIssueImportPlan,
  readback: Awaited<ReturnType<AkbJiraMigrationTarget["readIssue"]>> | null,
  postRelatedContent?: string,
): boolean => {
  const state = issueReadbackApprovalState(plan, readback);
  if (!state || !readback) return false;
  const desiredProjection = state.desired;
  const actualProjection = state.actual;
  const desiredMigration = (
    desiredProjection.custom_fields as Record<string, unknown>
  )?.jira_migration as Record<string, unknown> | undefined;
  const actualMigration = (
    actualProjection.custom_fields as Record<string, unknown>
  )?.jira_migration as Record<string, unknown> | undefined;
  return (
    desiredMigration?.owner !== undefined &&
    actualMigration?.owner !== undefined &&
    fingerprintJiraState(desiredMigration.owner) ===
      fingerprintJiraState(actualMigration.owner) &&
    fingerprintJiraState(desiredProjection) ===
      fingerprintJiraState(actualProjection) &&
    (readback.content === plan.desired.content ||
      readback.content === postRelatedContent)
  );
};

export const issueOwnerMatches = (
  plan: JiraIssueImportPlan,
  readback: Awaited<ReturnType<AkbJiraMigrationTarget["readIssue"]>> | null,
): boolean => {
  const desiredCustom = plan.desired.issue?.custom_fields;
  const actualCustom = readback?.issue.custom_fields;
  const desiredMigration =
    desiredCustom &&
    typeof desiredCustom === "object" &&
    !Array.isArray(desiredCustom) &&
    desiredCustom.jira_migration &&
    typeof desiredCustom.jira_migration === "object" &&
    !Array.isArray(desiredCustom.jira_migration)
      ? (desiredCustom.jira_migration as Record<string, unknown>)
      : null;
  const actualMigration =
    actualCustom &&
    typeof actualCustom === "object" &&
    !Array.isArray(actualCustom) &&
    actualCustom.jira_migration &&
    typeof actualCustom.jira_migration === "object" &&
    !Array.isArray(actualCustom.jira_migration)
      ? (actualCustom.jira_migration as Record<string, unknown>)
      : null;
  const desiredOwner = jiraOwnerIdentity(desiredMigration?.owner);
  return (
    desiredOwner !== null &&
    jiraOwnerIdentity(actualMigration?.owner) === desiredOwner
  );
};

export const sourceFingerprintForPlanning = (
  action: JiraPlanningAction,
): string => fingerprintJiraState(action.provenance.source);

export const mappedFingerprintForPlanning = (
  action: JiraPlanningAction,
): string =>
  fingerprintJiraState({
    target: action.target,
    source_identity: action.sourceIdentity,
  });

const legacyMappedFingerprintForPlanning = (
  action: JiraPlanningAction,
  classification: JiraPlanningAction["classification"],
): string =>
  fingerprintJiraState({
    target: action.target,
    classification,
  });

export const canRecoverApprovedPlanningCreate = (
  action: JiraPlanningAction,
  ledger: JiraMigrationLedgerV1,
): boolean => {
  if (action.classification !== "reuse" || action.reason !== "ledger_binding") {
    return false;
  }
  const binding = ledger.bindings.find(
    (candidate) => candidate.source_key === action.sourceIdentity.key,
  );
  return (
    binding !== undefined &&
    binding.source_fingerprint === sourceFingerprintForPlanning(action) &&
    (binding.mapped_state_fingerprint ===
      mappedFingerprintForPlanning(action) ||
      binding.mapped_state_fingerprint ===
        legacyMappedFingerprintForPlanning(action, "create"))
  );
};
