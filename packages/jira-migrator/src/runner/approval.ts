import type { IssueMetadata } from "@reef/core";
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
import { issueProjection } from "./targetSupport.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const migrationTimeToken = "<migration-time>";
const retrievalTimeToken = "<retrieval-time>";
const observationTimeToken = "<observation-time>";
const paginationToken = "<pagination-token>";
const archiveRunToken = "<archive-run>";
const volatileJiraFieldToken = "<volatile-jira-field>";
const jiraDevelopmentSummarySchema =
  "com.atlassian.jira.plugins.jira-development-integration-plugin:devsummarycf";

const normalizeApprovalMetadata = (
  value: unknown,
  volatileFieldIds: ReadonlySet<string> = new Set(),
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) =>
      normalizeApprovalMetadata(item, volatileFieldIds),
    );
  }
  if (!isRecord(value)) return value;
  const isArchiveReference =
    typeof value.runId === "string" &&
    typeof value.entryId === "string" &&
    typeof value.contentSha256 === "string";
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      volatileFieldIds.has(key)
        ? volatileJiraFieldToken
        : key === "nextPageToken" && typeof item === "string"
          ? paginationToken
          : key === "runId" && isArchiveReference
            ? archiveRunToken
            : normalizeApprovalMetadata(item, volatileFieldIds),
    ]),
  );
};

export const jiraApprovalPlanProjection = (value: unknown): unknown => {
  if (!isRecord(value)) return value;

  const sourceFields =
    isRecord(value.source) && Array.isArray(value.source.fields)
      ? [...value.source.fields].sort((left, right) =>
          fingerprintJiraState(left).localeCompare(fingerprintJiraState(right)),
        )
      : null;
  const volatileFieldIds = new Set(
    (sourceFields ?? []).flatMap((field) =>
      isRecord(field) &&
      typeof field.id === "string" &&
      isRecord(field.schema) &&
      field.schema.custom === jiraDevelopmentSummarySchema
        ? [field.id]
        : [],
    ),
  );
  const source = isRecord(value.source)
    ? normalizeApprovalMetadata(
        {
          ...value.source,
          fields: sourceFields ?? value.source.fields,
        },
        volatileFieldIds,
      )
    : value.source;

  const issues = Array.isArray(value.issues)
    ? value.issues.map((item) => {
        if (!isRecord(item)) return item;
        const desired = isRecord(item.desired) ? item.desired : null;
        const issue = desired && isRecord(desired.issue) ? desired.issue : null;
        const issueSource = isRecord(item.source) ? item.source : null;
        const fieldCatalog =
          issueSource && isRecord(issueSource.fieldCatalog)
            ? issueSource.fieldCatalog
            : null;
        return {
          ...item,
          source:
            issueSource && fieldCatalog
              ? {
                  ...issueSource,
                  fieldCatalog: {
                    ...fieldCatalog,
                    retrievedAt: retrievalTimeToken,
                  },
                }
              : item.source,
          desired:
            desired && issue
              ? {
                  ...desired,
                  issue: {
                    ...issue,
                    created_at: migrationTimeToken,
                    updated_at: migrationTimeToken,
                  },
                }
              : item.desired,
        };
      })
    : value.issues;

  const relatedMapping = isRecord(value.related_mapping)
    ? value.related_mapping
    : null;
  const accounts =
    relatedMapping && isRecord(relatedMapping.accounts)
      ? Object.fromEntries(
          Object.entries(relatedMapping.accounts).map(
            ([accountId, account]) => [
              accountId,
              isRecord(account)
                ? { ...account, lastSeenAt: observationTimeToken }
                : account,
            ],
          ),
        )
      : null;

  return normalizeApprovalMetadata({
    ...value,
    source,
    issues,
    related_mapping:
      relatedMapping && accounts
        ? { ...relatedMapping, accounts }
        : value.related_mapping,
  });
};

export const fingerprintJiraApprovalPlan = (value: unknown): string =>
  fingerprintJiraState(jiraApprovalPlanProjection(value));

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
  const semanticPlanningTarget = (value: unknown): unknown =>
    typeof value === "string" ? (tokens.get(value) ?? value) : value;
  const desiredIssue = plan.desired.issue;
  const desiredCustomFields =
    desiredIssue && isRecord(desiredIssue.custom_fields)
      ? desiredIssue.custom_fields
      : {};
  const desiredJira = isRecord(desiredCustomFields.jira)
    ? desiredCustomFields.jira
    : {};
  const desiredPlanning = Array.isArray(desiredJira.planning)
    ? desiredJira.planning.map((item) =>
        isRecord(item)
          ? {
              ...item,
              target_id: semanticPlanningTarget(item.target_id),
            }
          : item,
      )
    : desiredJira.planning;
  return {
    source: plan.source,
    desired: {
      ...plan.desired,
      issue: desiredIssue
        ? {
            ...desiredIssue,
            release_id: desiredIssue.release_id
              ? semanticPlanningTarget(desiredIssue.release_id)
              : desiredIssue.release_id,
            sprint_id: desiredIssue.sprint_id
              ? semanticPlanningTarget(desiredIssue.sprint_id)
              : desiredIssue.sprint_id,
            custom_fields: {
              ...desiredCustomFields,
              jira: {
                ...desiredJira,
                planning: desiredPlanning,
              },
            },
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
  operations: report.operations,
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
    description_updated: report.media.description_updated,
    by_strategy: report.media.by_strategy,
  },
  links: {
    entries: report.links.entries,
    unique: report.links.unique,
    unresolved: report.links.unresolved,
    externalized: report.links.externalized,
    unmapped: report.links.unmapped,
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
  ) as Array<keyof IssueMetadata>;
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
    const projection = issueProjection(issue as unknown as IssueMetadata, keys);
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

export const completedIssueReadbackMatches = (
  currentPlan: JiraIssueImportPlan,
  approvedPlan: JiraIssueImportPlan,
  readback: Awaited<ReturnType<AkbJiraMigrationTarget["readIssue"]>> | null,
  postRelatedContent?: string,
): boolean =>
  baseIssueReadbackMatches(currentPlan, readback, postRelatedContent) ||
  baseIssueReadbackMatches(approvedPlan, readback, postRelatedContent);

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
