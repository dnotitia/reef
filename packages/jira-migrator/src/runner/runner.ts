import { createHash } from "node:crypto";
import { readFile, realpath, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import {
  loadJiraAccountMappingArtifact,
  writeJiraAccountMappingArtifact,
} from "../accounts/artifactFile.js";
import {
  buildJiraAccountMigrationReport,
  collectJiraUserObservations,
  upsertJiraAccountMappingArtifact,
} from "../accounts/mapping.js";
import {
  type JiraMigratorConfig,
  secretValuesForConfig,
} from "../cli/config.js";
import {
  finalizeJiraMigrationPhase,
  recordJiraMigrationResult,
} from "../execution/checkpoint.js";
import { fingerprintJiraState } from "../execution/diff.js";
import {
  loadJiraMigrationLedger,
  writeJiraMigrationLedger,
} from "../execution/ledgerFile.js";
import {
  type JiraChangelogPlan,
  buildJiraChangelogPlan,
} from "../issues/changelog.js";
import type {
  JiraIssueDeferredItem,
  JiraIssueImportPlan,
} from "../issues/importPlan.js";
import { buildJiraIssueImportPlan } from "../issues/mapping.js";
import { JiraReadClient } from "../jira/client.js";
import { buildJiraFieldCatalog } from "../jira/fieldCatalog.js";
import {
  type JiraMigrationAction,
  JiraMigrationBindingSchema,
  type JiraMigrationEntityResult,
  type JiraMigrationLedgerV1,
  type JiraMigrationPhase,
  confirmJiraMigrationBinding,
  getJiraPlanningLedgerBindings,
  jiraAttachmentSourceIdentity,
  jiraIssueSourceIdentity,
  openJiraMigrationRun,
  removeJiraMigrationBindings,
} from "../ledger.js";
import type { NormalizedJiraIssue } from "../payloads.js";
import {
  type JiraIssuePayload,
  normalizeIssueSprintReferences,
} from "../payloads.js";
import {
  type JiraPlanningAction,
  type JiraPlanningTargetResolution,
  buildJiraPlanningMigrationPlan,
  buildJiraPlanningTargetMappings,
} from "../planning/entities.js";
import { type RawArchiveReference, createRawArchive } from "../rawArchive.js";
import {
  type JiraRelatedImportReport,
  importJiraRelatedData,
} from "../related/import.js";
import { rewriteMedia } from "../related/media.js";
import { reportTemplate } from "../related/reporting.js";
import {
  approvalRelevantReport,
  baseIssueReadbackMatches,
  canRecoverApprovedPlanningCreate,
  issueOwnerMatches,
  issueReadbackApprovalFingerprint,
  mappedFingerprintForPlanning,
  planningResolutionsForApproval,
  planningSourceProjection,
  safePlanningAction,
  semanticIssuePlan,
  semanticRelatedReport,
  sourceFingerprintForPlanning,
} from "./approval.js";
import {
  ensurePrivateDirectory,
  fileExists,
  jiraEndpointFingerprint,
  privateSpoolSegment,
  requireArtifactPaths,
  targetEndpointFingerprint,
} from "./artifacts.js";
import { JiraRunnerError } from "./errors.js";
import {
  type LoadedJiraMappingPolicy,
  loadJiraMappingPolicy,
} from "./mappingPolicy.js";
import {
  acquireMigrationRunLock,
  readPrivatePlanArtifact,
  writePrivatePlanArtifact,
} from "./privateArtifact.js";
import {
  type JiraRunnerReport,
  buildJiraRunnerReport,
  loadJiraRunnerReport,
  writeJiraRunnerReport,
} from "./report.js";
import { retryOperation } from "./retry.js";
import {
  assertUniqueJiraIssues,
  readAllChangelog,
  readAllProjectIssues,
  readBoardSprints,
} from "./source.js";
import {
  type RelatedSourceSnapshot,
  getRelatedBinarySpools,
  snapshotJiraClient,
} from "./sourceSnapshot.js";
import {
  type AkbJiraMigrationTarget,
  JiraTargetConflictError,
  createAkbJiraMigrationTarget,
} from "./targetAdapter.js";

export interface JiraRunnerDependencies {
  createJiraClient?: (projectKey: string) => JiraReadClient;
  target?: AkbJiraMigrationTarget;
  now?: () => string;
  failAfterConfirmedEntities?: number;
  signal?: AbortSignal;
}

export interface JiraRunnerResult {
  runId: string;
  mode: "dry-run" | "apply";
  planSha256: string;
  report: JiraRunnerReport;
  ledger: JiraMigrationLedgerV1;
}

export { JiraRunnerError } from "./errors.js";
export {
  baseIssueReadbackMatches,
  canRecoverApprovedPlanningCreate,
  issueReadbackApprovalFingerprint,
} from "./approval.js";

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

const reconciliationAction = (
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

const projectId = (issue: NormalizedJiraIssue): string =>
  String(issue.raw.fields.project?.id ?? issue.projectKey ?? "unknown");

const mappedFingerprintForChangelog = (plan: JiraChangelogPlan): string =>
  fingerprintJiraState({
    report: plan.report,
    items: plan.items,
  });

const legacyMappedFingerprintForChangelog = (plan: JiraChangelogPlan): string =>
  fingerprintJiraState(plan.report);

const safeMigrationFailureReason = (
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

const resultFor = (input: {
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

const actionForPlanning = (
  classification: JiraPlanningAction["classification"],
): JiraMigrationAction => {
  if (classification === "create") return "create";
  if (classification === "reuse") return "skip";
  return "conflict";
};

const actionForIssuePlan = (
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
  return report.comments.updated + report.deletions > 0 ? "update" : "skip";
};

const mergePlanningActions = (
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

const reportMatchesConfig = (
  report: JiraRunnerReport,
  config: JiraMigratorConfig,
): boolean =>
  report.run.mode === "dry-run" &&
  report.run.status === "completed" &&
  report.run.run_id === config.artifacts.runId &&
  report.run.source.jira_cloud_id === config.jira.cloudId &&
  JSON.stringify(report.run.source.project_keys) ===
    JSON.stringify(config.jira.projectKeys) &&
  JSON.stringify(report.run.source.board_ids) ===
    JSON.stringify(config.jira.boardIds) &&
  report.run.target.vault === config.target.vault;

async function runJiraMigrationUnlocked(
  config: JiraMigratorConfig,
  dependencies: JiraRunnerDependencies = {},
): Promise<JiraRunnerResult> {
  if (
    config.mode === "apply" &&
    !/^[a-f0-9]{64}$/u.test(config.expectedPlanSha256 ?? "")
  ) {
    throw new JiraRunnerError("dry_run_approval_required");
  }
  const assertNotAborted = (): void => {
    if (dependencies.signal?.aborted) {
      throw new JiraRunnerError("interrupted");
    }
  };
  const paths = requireArtifactPaths(config);
  for (const directory of new Set([
    dirname(paths.ledgerPath),
    dirname(paths.reportPath),
    dirname(paths.accountMappingPath),
    paths.archiveRoot,
  ])) {
    await ensurePrivateDirectory(directory);
  }
  const now = dependencies.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const endpointFingerprint = targetEndpointFingerprint(config.target.baseUrl);
  const sourceEndpointFingerprint = jiraEndpointFingerprint(
    config.jira.baseUrl,
  );
  const target =
    dependencies.target ??
    createAkbJiraMigrationTarget({
      baseUrl: config.target.baseUrl,
      jwt: config.target.jwt,
      vault: config.target.vault,
    });
  const createClient =
    dependencies.createJiraClient ??
    ((projectKey: string) =>
      new JiraReadClient({
        baseUrl: config.jira.baseUrl,
        projectKey,
        auth: config.jira.auth,
      }));
  const policies = new Map<string, LoadedJiraMappingPolicy>();
  for (const key of config.jira.projectKeys) {
    const path = config.jira.mappingPolicyPaths[key];
    if (!path) throw new JiraRunnerError("mapping_policy_required");
    policies.set(key, await loadJiraMappingPolicy(path));
  }

  let approvedReport: JiraRunnerReport | null = null;
  let approvedPlanArtifact: Awaited<
    ReturnType<typeof readPrivatePlanArtifact>
  > | null = null;
  if (config.mode === "apply") {
    const approvalReportPath = `${paths.reportPath}.approval.json`;
    if (!(await fileExists(approvalReportPath))) {
      throw new JiraRunnerError("dry_run_approval_required");
    }
    approvedReport = await loadJiraRunnerReport(approvalReportPath);
    if (!reportMatchesConfig(approvedReport, config)) {
      throw new JiraRunnerError("dry_run_scope_mismatch");
    }
    try {
      approvedPlanArtifact = await readPrivatePlanArtifact(
        `${paths.reportPath}.plan.json`,
      );
    } catch {
      throw new JiraRunnerError("dry_run_approval_required");
    }
    if (
      approvedPlanArtifact.approval_report_sha256 !==
      fingerprintJiraState(approvedReport)
    ) {
      throw new JiraRunnerError("plan_fingerprint_mismatch");
    }
    if (
      approvedPlanArtifact.run_id !== config.artifacts.runId ||
      approvedPlanArtifact.source.jira_cloud_id !== config.jira.cloudId ||
      JSON.stringify(approvedPlanArtifact.source.project_keys) !==
        JSON.stringify(config.jira.projectKeys) ||
      JSON.stringify(approvedPlanArtifact.source.board_ids) !==
        JSON.stringify(config.jira.boardIds) ||
      approvedPlanArtifact.source.endpoint_fingerprint !==
        sourceEndpointFingerprint ||
      approvedPlanArtifact.target.vault !== config.target.vault ||
      approvedPlanArtifact.target.endpoint_fingerprint !==
        endpointFingerprint ||
      approvedPlanArtifact.plan_sha256 !== approvedReport.plan_sha256
    ) {
      throw new JiraRunnerError("dry_run_scope_mismatch");
    }
  } else if (await fileExists(`${paths.reportPath}.plan.json`)) {
    approvedPlanArtifact = await readPrivatePlanArtifact(
      `${paths.reportPath}.plan.json`,
    );
    if (
      approvedPlanArtifact.run_id !== config.artifacts.runId ||
      approvedPlanArtifact.source.jira_cloud_id !== config.jira.cloudId ||
      JSON.stringify(approvedPlanArtifact.source.project_keys) !==
        JSON.stringify(config.jira.projectKeys) ||
      JSON.stringify(approvedPlanArtifact.source.board_ids) !==
        JSON.stringify(config.jira.boardIds) ||
      approvedPlanArtifact.source.endpoint_fingerprint !==
        sourceEndpointFingerprint ||
      approvedPlanArtifact.target.vault !== config.target.vault ||
      approvedPlanArtifact.target.endpoint_fingerprint !== endpointFingerprint
    ) {
      throw new JiraRunnerError("dry_run_scope_mismatch");
    }
  }
  const approvedRelatedSnapshots = (() => {
    const payload = approvedPlanArtifact?.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    const source = (payload as Record<string, unknown>).source;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return null;
    }
    const related = (source as Record<string, unknown>).related;
    return related && typeof related === "object" && !Array.isArray(related)
      ? (related as Record<string, unknown>)
      : null;
  })();
  const retry = {
    maxRetries: config.control.retryCount,
    baseDelayMs: config.control.retryBaseDelayMs,
    maxDelayMs: config.control.retryMaxDelayMs,
    signal: dependencies.signal,
    abortError: () => new JiraRunnerError("interrupted"),
  };
  const relatedSourceSnapshots = new Map<string, RelatedSourceSnapshot>();
  const clients = new Map(
    config.jira.projectKeys.map((key) => {
      const approvedSnapshot = approvedRelatedSnapshots?.[key];
      const approvedAttachments =
        approvedSnapshot &&
        typeof approvedSnapshot === "object" &&
        !Array.isArray(approvedSnapshot) &&
        (approvedSnapshot as Record<string, unknown>).attachments &&
        typeof (approvedSnapshot as Record<string, unknown>).attachments ===
          "object" &&
        !Array.isArray(
          (approvedSnapshot as Record<string, unknown>).attachments,
        )
          ? ((approvedSnapshot as Record<string, unknown>)
              .attachments as RelatedSourceSnapshot["attachments"])
          : {};
      const snapshot: RelatedSourceSnapshot = {
        comments: {},
        remote_links: {},
        attachments: { ...approvedAttachments },
      };
      relatedSourceSnapshots.set(key, snapshot);
      return [
        key,
        snapshotJiraClient(
          createClient(key),
          snapshot,
          join(
            paths.archiveRoot,
            ".spool",
            privateSpoolSegment(config.artifacts.runId),
            privateSpoolSegment(key),
          ),
          retry,
        ),
      ] as const;
    }),
  );

  let ledger = await loadJiraMigrationLedger({
    path: paths.ledgerPath,
    jiraCloudId: config.jira.cloudId,
    targetVault: config.target.vault,
  });
  const runAt =
    ledger.runs.find((run) => run.run_id === config.artifacts.runId)
      ?.started_at ?? startedAt;
  let persistedLedger = ledger;
  const persistLedger = async (next: JiraMigrationLedgerV1): Promise<void> => {
    await writeJiraMigrationLedger({
      path: paths.ledgerPath,
      ledger: next,
      expectedLedger: persistedLedger,
      forbiddenSecretValues: secretValuesForConfig(config),
    });
    persistedLedger = next;
    ledger = next;
  };

  const targetPreflight = await target.preflight();
  if (
    (approvedReport &&
      approvedReport.run.target.actor !== targetPreflight.actor) ||
    (approvedPlanArtifact &&
      approvedPlanArtifact.target.actor !== targetPreflight.actor)
  ) {
    throw new JiraRunnerError("dry_run_scope_mismatch");
  }
  const firstClient = clients.get(config.jira.projectKeys[0] as string);
  if (!firstClient) throw new Error("jira_client_missing");
  const fieldResult = await retryOperation(() => firstClient.listFields(), {
    ...retry,
    operationKind: "read",
  });
  const fieldCatalog = buildJiraFieldCatalog({
    fields: fieldResult.items,
    retrievedAt: runAt,
  });
  const boardCatalogs = await readBoardSprints(
    firstClient,
    config.jira.boardIds,
    retry,
  );
  const versionsByProject = new Map();
  const projectDetailsByProject = new Map<
    string,
    Awaited<ReturnType<JiraReadClient["getProject"]>>
  >();
  const issuesByProject = new Map<string, NormalizedJiraIssue[]>();
  const versionPagesByProject = new Map<string, unknown[]>();
  const issuePagesByProject = new Map<string, unknown[]>();
  for (const key of config.jira.projectKeys) {
    const client = clients.get(key);
    if (!client) throw new Error("jira_client_missing");
    const [project, versions, issues] = await Promise.all([
      retryOperation(() => client.getProject(key), {
        ...retry,
        operationKind: "read",
      }),
      retryOperation(
        () => client.readProjectVersionCatalog({ projectIdOrKey: key }),
        { ...retry, operationKind: "read" },
      ),
      readAllProjectIssues(client, key, retry),
    ]);
    projectDetailsByProject.set(key, project);
    versionsByProject.set(key, versions.items);
    versionPagesByProject.set(key, versions.pages);
    issuesByProject.set(key, issues.items);
    issuePagesByProject.set(key, issues.pages);
  }
  const allIssues = [...issuesByProject.values()]
    .flat()
    .sort((left, right) => left.key.localeCompare(right.key));
  assertUniqueJiraIssues(allIssues);
  const projectKeyById = new Map<string, string>();
  for (const [projectKey, detail] of projectDetailsByProject) {
    projectKeyById.set(detail.project.id, projectKey);
  }
  for (const [projectKey, issues] of issuesByProject) {
    for (const issue of issues) {
      projectKeyById.set(projectId(issue), projectKey);
    }
  }
  for (const [projectKey, versions] of versionsByProject) {
    for (const version of versions) {
      projectKeyById.set(version.projectId, projectKey);
    }
  }
  const currentIssueSourceIds = new Set(
    allIssues.flatMap((issue) => [issue.id, issue.key]),
  );
  const discoveredAbsentSourceRelationBindings = ledger.bindings.filter(
    (binding) => {
      if (
        binding.source_identity.entity_kind !== "relation" ||
        binding.source_identity.jira_cloud_id !== config.jira.cloudId
      ) {
        return false;
      }
      const projectKey = inferRelationSourceProjectKey({
        binding,
        ledger,
        currentIssues: allIssues,
        configuredProjectKeys: config.jira.projectKeys,
        projectKeyById,
      });
      return (
        projectKey !== undefined &&
        config.jira.projectKeys.includes(projectKey) &&
        !currentIssueSourceIds.has(binding.source_identity.source_issue_id)
      );
    },
  );
  const approvedPayload =
    approvedPlanArtifact?.payload &&
    typeof approvedPlanArtifact.payload === "object" &&
    !Array.isArray(approvedPlanArtifact.payload)
      ? (approvedPlanArtifact.payload as Record<string, unknown>)
      : null;
  const approvedCommentBindingPreconditions =
    approvedPayload?.comment_binding_preconditions &&
    typeof approvedPayload.comment_binding_preconditions === "object" &&
    !Array.isArray(approvedPayload.comment_binding_preconditions)
      ? (approvedPayload.comment_binding_preconditions as Record<
          string,
          unknown
        >)
      : null;
  const approvedCommentBindings = (
    issueKey: string,
  ): JiraMigrationLedgerV1["bindings"] | undefined => {
    if (!approvedCommentBindingPreconditions) return undefined;
    const bindings = approvedCommentBindingPreconditions[issueKey];
    if (!Array.isArray(bindings)) {
      throw new JiraRunnerError("dry_run_scope_mismatch");
    }
    return bindings.map((binding) => {
      const parsed = JiraMigrationBindingSchema.safeParse(binding);
      if (
        !parsed.success ||
        parsed.data.source_identity.entity_kind !== "comment"
      ) {
        throw new JiraRunnerError("dry_run_scope_mismatch");
      }
      return parsed.data;
    });
  };
  const approvedAbsentSourceRelations = Array.isArray(
    approvedPayload?.absent_source_relations,
  )
    ? approvedPayload.absent_source_relations.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new JiraRunnerError("dry_run_scope_mismatch");
        }
        const relation = value as Record<string, unknown>;
        if (
          typeof relation.source_key !== "string" ||
          (relation.target !== null && typeof relation.target !== "string")
        ) {
          throw new JiraRunnerError("dry_run_scope_mismatch");
        }
        return {
          source_key: relation.source_key,
          target: relation.target as string | null,
        };
      })
    : null;
  const absentSourceRelationPlan =
    approvedAbsentSourceRelations ??
    discoveredAbsentSourceRelationBindings.map((binding) => ({
      source_key: binding.source_key,
      target:
        binding.target.target_kind === "relation"
          ? binding.target.idempotency_key
          : null,
    }));
  const approvedIssueIds =
    approvedPayload?.issue_ids &&
    typeof approvedPayload.issue_ids === "object" &&
    !Array.isArray(approvedPayload.issue_ids)
      ? (approvedPayload.issue_ids as Record<string, unknown>)
      : null;
  const issueIds = approvedIssueIds
    ? allIssues.map((issue) => {
        const id = approvedIssueIds[issue.key];
        if (typeof id !== "string" || id.length === 0) {
          throw new JiraRunnerError("dry_run_scope_mismatch");
        }
        return id;
      })
    : await target.planIssueIds(
        allIssues.map((issue) => ({
          jira_cloud_id: config.jira.cloudId,
          project_key: issue.projectKey ?? issue.key.split("-")[0] ?? issue.key,
          issue_id: issue.id,
          issue_key: issue.key,
        })),
      );
  const targetIdsByJiraKey = Object.fromEntries(
    allIssues.map((issue, index) => [issue.key, issueIds[index] as string]),
  );
  const changelogByIssue = new Map<
    string,
    Awaited<ReturnType<typeof readAllChangelog>>["items"]
  >();
  const changelogPagesByIssue = new Map<string, unknown[]>();
  for (const issue of allIssues) {
    const client = clients.get(
      issue.projectKey ?? issue.key.split("-")[0] ?? "",
    );
    if (!client) throw new Error("jira_client_missing");
    const changelog = await readAllChangelog(client, issue.key, retry);
    changelogByIssue.set(issue.key, changelog.items);
    changelogPagesByIssue.set(issue.key, changelog.pages);
  }
  const commentsByIssue = new Map<
    string,
    Awaited<ReturnType<JiraReadClient["readComments"]>>["items"]
  >();
  for (const issue of allIssues) {
    const client = clients.get(
      issue.projectKey ?? issue.key.split("-")[0] ?? "",
    );
    if (!client) throw new Error("jira_client_missing");
    // `readComments` returns a complete JiraCatalogResult: JiraReadClient
    // drains every startAt cursor internally, and the snapshot proxy caches
    // that full catalog for the later related-data planning/apply pass.
    const comments = await client.readComments(issue.key);
    commentsByIssue.set(issue.key, comments.items);
  }

  let accountMapping = await loadJiraAccountMappingArtifact({
    path: paths.accountMappingPath,
    jiraCloudId: config.jira.cloudId,
  });
  accountMapping = upsertJiraAccountMappingArtifact({
    artifact: accountMapping,
    observations: allIssues.flatMap((issue) =>
      collectJiraUserObservations({
        issue: issue.raw,
        comments: commentsByIssue.get(issue.key) ?? [],
        changelog: changelogByIssue.get(issue.key) ?? [],
      }),
    ),
    observedAt: runAt,
  }).artifact;
  const accountReport = buildJiraAccountMigrationReport(accountMapping);

  const archiveReferences = new Map<
    string,
    { issue: RawArchiveReference; descriptionAdf?: RawArchiveReference }
  >();
  const changelogArchiveReferences = new Map<string, RawArchiveReference>();
  const archiveSummaries = [];
  const archivesByProject = new Map<
    string,
    ReturnType<typeof createRawArchive>
  >();
  for (const key of config.jira.projectKeys) {
    const archive = createRawArchive({
      root: join(paths.archiveRoot, key.toLowerCase()),
      runId: config.artifacts.runId,
      sourceScope: { cloud_id: config.jira.cloudId, project_key: key },
      createdAt: runAt,
      retention: {
        owner: targetPreflight.actor,
        retention_until: new Date(
          Date.parse(runAt) + 7 * 365 * 24 * 60 * 60 * 1_000,
        ).toISOString(),
        policy_ref: "docs/jira-migration.md",
      },
      permissionVerification:
        process.platform === "win32"
          ? {
              kind: "external_acl",
              verified_by: targetPreflight.actor,
              verified_at: runAt,
            }
          : { kind: "posix_mode", verified: true },
      forbiddenSecretValues: secretValuesForConfig(config),
    });
    archivesByProject.set(key, archive);
    const archivePages = async (
      endpointKind: string,
      pathname: string,
      pages: readonly unknown[],
    ): Promise<void> => {
      for (const [pageIndex, payload] of pages.entries()) {
        await archive.archive({
          entityKind: "response_page",
          sourceIdentity: {
            cloud_id: config.jira.cloudId,
            project_key: key,
            endpoint_kind: endpointKind,
            page_index: String(pageIndex),
          },
          sourceEndpoint: { method: "GET", pathname },
          classification: "restricted_pii",
          fetchedAt: runAt,
          payload,
        });
      }
    };
    if (key === config.jira.projectKeys[0]) {
      await archivePages("field_catalog", "/rest/api/3/field", [
        fieldResult.raw,
      ]);
      for (const { boardId, catalog } of boardCatalogs) {
        await archivePages(
          `board_sprints:${boardId}`,
          `/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint`,
          catalog.pages,
        );
      }
    }
    await archivePages(
      "project_versions",
      `/rest/api/3/project/${encodeURIComponent(key)}/version`,
      versionPagesByProject.get(key) ?? [],
    );
    await archivePages(
      "issue_search",
      "/rest/api/3/search/jql",
      issuePagesByProject.get(key) ?? [],
    );
    for (const issue of issuesByProject.get(key) ?? []) {
      const issueReference = await archive.archive({
        entityKind: "issue",
        sourceIdentity: {
          cloud_id: config.jira.cloudId,
          project_key: key,
          issue_id: issue.id,
        },
        sourceEndpoint: {
          method: "GET",
          pathname: "/rest/api/3/search/jql",
        },
        classification: "restricted_pii",
        fetchedAt: runAt,
        payload: issue.raw,
      });
      let descriptionAdf: RawArchiveReference | undefined;
      if (issue.description !== null && typeof issue.description === "object") {
        descriptionAdf = await archive.archive({
          entityKind: "description_adf",
          sourceIdentity: {
            cloud_id: config.jira.cloudId,
            issue_id: issue.id,
            entity_kind: "description_adf",
          },
          sourceEndpoint: {
            method: "GET",
            pathname: "/rest/api/3/search/jql",
          },
          classification: "restricted_pii",
          fetchedAt: runAt,
          payload: issue.description,
        });
      }
      archiveReferences.set(issue.key, {
        issue: issueReference,
        ...(descriptionAdf ? { descriptionAdf } : {}),
      });
      for (const history of changelogByIssue.get(issue.key) ?? []) {
        const historyReference = await archive.archive({
          entityKind: "changelog_history",
          sourceIdentity: {
            cloud_id: config.jira.cloudId,
            issue_id: issue.id,
            history_id: history.id,
          },
          sourceEndpoint: {
            method: "GET",
            pathname: `/rest/api/3/issue/${encodeURIComponent(issue.key)}/changelog`,
          },
          classification: "restricted_pii",
          fetchedAt: runAt,
          payload: history,
        });
        changelogArchiveReferences.set(
          `${issue.id}:${history.id}`,
          historyReference,
        );
      }
      await archivePages(
        `changelog:${issue.key}`,
        `/rest/api/3/issue/${encodeURIComponent(issue.key)}/changelog`,
        changelogPagesByIssue.get(issue.key) ?? [],
      );
    }
  }

  const planningActions = mergePlanningActions(
    config.jira.projectKeys.flatMap((key, index) => {
      const issueSprints = (issuesByProject.get(key) ?? []).flatMap((issue) =>
        normalizeIssueSprintReferences(issue.raw, fieldCatalog.fields),
      );
      return buildJiraPlanningMigrationPlan({
        jiraCloudId: config.jira.cloudId,
        projectKey: key,
        versions: versionsByProject.get(key) ?? [],
        issueSprints,
        configuredBoards:
          index === 0
            ? boardCatalogs.map(({ boardId, catalog }) => ({
                boardId,
                sprints: catalog.items,
              }))
            : [],
        existingReleases: targetPreflight.planning.releases,
        existingSprints: targetPreflight.planning.sprints,
        ledgerBindings: getJiraPlanningLedgerBindings(ledger),
      }).actions;
    }),
  );
  const existingPlanningResolutions: JiraPlanningTargetResolution[] =
    planningActions.flatMap((action) =>
      action.classification === "reuse" && action.targetId
        ? [
            {
              sourceIdentity: action.sourceIdentity,
              targetKind:
                action.sourceIdentity.kind === "version"
                  ? ("release" as const)
                  : ("sprint" as const),
              targetId: action.targetId,
            },
          ]
        : [],
    );
  const approvedPlanningResolutions =
    planningResolutionsForApproval(planningActions);
  const buildIssuePlans = (
    resolutions: readonly JiraPlanningTargetResolution[],
  ): JiraIssueImportPlan[] => {
    const mappings = buildJiraPlanningTargetMappings(resolutions);
    return allIssues.map((issue) => {
      const key = issue.projectKey ?? issue.key.split("-")[0] ?? "unknown";
      const policy = policies.get(key);
      if (!policy) throw new JiraRunnerError("mapping_policy_required");
      return buildJiraIssueImportPlan({
        issue: issue.raw as JiraIssuePayload,
        targetReefId: targetIdsByJiraKey[issue.key] as string,
        jiraCloudId: config.jira.cloudId,
        targetVault: config.target.vault,
        runAt,
        migrationActor: targetPreflight.actor,
        fieldCatalog,
        policy,
        accountMapping: { artifact: accountMapping },
        planningMappings: mappings,
        targetIdsByJiraKey,
        rawArchiveReferences: archiveReferences.get(issue.key) ?? {},
      });
    });
  };
  const dryIssuePlans = buildIssuePlans(approvedPlanningResolutions);
  const approvedTargetIssuePreconditions =
    approvedPayload?.target_issue_preconditions &&
    typeof approvedPayload.target_issue_preconditions === "object" &&
    !Array.isArray(approvedPayload.target_issue_preconditions)
      ? (approvedPayload.target_issue_preconditions as Record<string, unknown>)
      : null;
  const targetIssuePreconditions: Record<string, string | null> =
    approvedTargetIssuePreconditions
      ? Object.fromEntries(
          dryIssuePlans.map((plan) => {
            const value =
              approvedTargetIssuePreconditions[plan.source.issueKey];
            if (value !== null && typeof value !== "string") {
              throw new JiraRunnerError("plan_fingerprint_mismatch");
            }
            return [plan.source.issueKey, value ?? null];
          }),
        )
      : Object.fromEntries(
          await Promise.all(
            dryIssuePlans.map(async (plan) => {
              if (actionForIssuePlan(plan, ledger) === "create") {
                return [plan.source.issueKey, null] as const;
              }
              const id = plan.desired.issue?.id;
              const readback = id
                ? await target.readIssue(id).catch(() => null)
                : null;
              return [
                plan.source.issueKey,
                issueReadbackApprovalFingerprint(plan, readback),
              ] as const;
            }),
          ),
        );
  const issueBindings = Object.fromEntries(
    allIssues.flatMap((issue) => [
      [issue.id, targetIdsByJiraKey[issue.key] as string],
      [issue.key, targetIdsByJiraKey[issue.key] as string],
    ]),
  );
  const actorBindings = Object.fromEntries(
    Object.values(accountMapping.accounts).map((account) => [
      account.accountId,
      account.actor,
    ]),
  );
  const changelogPlans: JiraChangelogPlan[] = [];
  for (const issue of allIssues) {
    const key = issue.projectKey ?? issue.key.split("-")[0] ?? "";
    const policy = policies.get(key);
    if (!policy) throw new JiraRunnerError("mapping_policy_required");
    const statusMappings = Object.fromEntries(
      policy.statuses.flatMap((mapping) =>
        [mapping.id, mapping.name]
          .filter((value): value is string => Boolean(value))
          .map((value) => [value, mapping.status]),
      ),
    );
    const issueTypeMappings = Object.fromEntries(
      policy.issueTypes.flatMap((mapping) =>
        [mapping.id, mapping.name]
          .filter((value): value is string => Boolean(value))
          .map((value) => [value, mapping.issueType]),
      ),
    );
    for (const history of changelogByIssue.get(issue.key) ?? []) {
      changelogPlans.push(
        buildJiraChangelogPlan({
          jiraCloudId: config.jira.cloudId,
          issueId: issue.id,
          reefId: targetIdsByJiraKey[issue.key] as string,
          history,
          rawArchiveReference: changelogArchiveReferences.get(
            `${issue.id}:${history.id}`,
          ),
          fieldCatalog,
          actorBindings,
          statusMappings,
          issueTypeMappings,
          issueBindings,
        }),
      );
    }
  }
  const relatedPlanningReports: Array<{
    issue_key: string;
    report: JiraRelatedImportReport;
  }> = [];
  for (const issue of allIssues) {
    const key = issue.projectKey ?? issue.key.split("-")[0] ?? "";
    const client = clients.get(key);
    const policy = policies.get(key);
    if (!client || !policy) throw new Error("jira_client_missing");
    const result = await importJiraRelatedData({
      jiraCloudId: config.jira.cloudId,
      issue: issue.raw,
      reefId: targetIdsByJiraKey[issue.key] as string,
      client,
      target: target.relatedTarget(),
      ledger,
      accountMapping,
      linkMappings: policy.linkMappings,
      attachmentPolicy: config.control.commentCatalogComplete
        ? {
            maxBytes: 20 * 1024 * 1024,
            commentVisibilityCompleteness: "verified" as const,
          }
        : undefined,
      resolveIssueTarget(sourceIdOrKey) {
        const reefId = issueBindings[sourceIdOrKey];
        return reefId
          ? {
              reefId,
              documentUri: `akb://${config.target.vault}/coll/issues/doc/${reefId.toLowerCase()}.md`,
            }
          : null;
      },
      mode: "dry-run",
      now: () => runAt,
    });
    relatedPlanningReports.push({
      issue_key: issue.key,
      report: result.report,
    });
  }
  const postRelatedContentByReefId = new Map<string, string>();
  for (const issue of allIssues) {
    const attachments = issue.attachments ?? [];
    const bindings = attachments.flatMap((attachment) => {
      const sourceKey = jiraAttachmentSourceIdentity(
        config.jira.cloudId,
        issue.id,
        attachment.id,
      ).key;
      const binding = ledger.bindings.find(
        (candidate) => candidate.source_key === sourceKey,
      );
      return binding?.target.target_kind === "attachment"
        ? [{ source: attachment, fileUri: binding.target.file_uri }]
        : [];
    });
    const rewritten = rewriteMedia(
      issue.description,
      bindings,
      typeof issue.raw.renderedFields?.description === "string"
        ? issue.raw.renderedFields.description
        : "",
      reportTemplate("dry-run"),
      issue.id,
      attachments,
    );
    if (rewritten.resolved && rewritten.changed) {
      postRelatedContentByReefId.set(
        targetIdsByJiraKey[issue.key] as string,
        rewritten.markdown,
      );
    }
  }
  for (const key of config.jira.projectKeys) {
    const archive = archivesByProject.get(key);
    const snapshot = relatedSourceSnapshots.get(key);
    if (!archive || !snapshot) continue;
    let pageIndex = 0;
    for (const [issueKey, response] of Object.entries(snapshot.comments)) {
      await archive.archive({
        entityKind: "response_page",
        sourceIdentity: {
          cloud_id: config.jira.cloudId,
          project_key: key,
          endpoint_kind: `comments:${issueKey}`,
          page_index: String(pageIndex++),
        },
        sourceEndpoint: {
          method: "GET",
          pathname: `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
        },
        classification: "restricted_pii",
        fetchedAt: runAt,
        payload: response,
      });
    }
    for (const [issueKey, response] of Object.entries(snapshot.remote_links)) {
      await archive.archive({
        entityKind: "response_page",
        sourceIdentity: {
          cloud_id: config.jira.cloudId,
          project_key: key,
          endpoint_kind: `remote_links:${issueKey}`,
          page_index: String(pageIndex++),
        },
        sourceEndpoint: {
          method: "GET",
          pathname: `/rest/api/3/issue/${encodeURIComponent(issueKey)}/remotelink`,
        },
        classification: "restricted_pii",
        fetchedAt: runAt,
        payload: response,
      });
    }
    const issueByAttachmentId = new Map(
      (issuesByProject.get(key) ?? []).flatMap((issue) =>
        (issue.attachments ?? []).map((attachment) => [
          attachment.id,
          issue.id,
        ]),
      ),
    );
    for (const [attachmentId, response] of getRelatedBinarySpools(snapshot)) {
      const bytes = await readFile(response.path);
      await archive.archive({
        entityKind: "attachment_content",
        sourceIdentity: {
          cloud_id: config.jira.cloudId,
          issue_id: issueByAttachmentId.get(attachmentId) ?? "unknown",
          attachment_id: attachmentId,
        },
        sourceEndpoint: {
          method: "GET",
          pathname: `/rest/api/3/attachment/content/${encodeURIComponent(attachmentId)}`,
        },
        classification: "restricted_pii",
        fetchedAt: runAt,
        payload: {
          content_base64: bytes.toString("base64"),
          content_type: response.contentType,
          content_length: response.contentLength,
        },
      });
    }
    archiveSummaries.push({ project_key: key, ...(await archive.verify()) });
  }
  let finalRelatedReports = relatedPlanningReports;
  const currentPlanningPayload = planningActions.map(safePlanningAction);
  const approvedPlanningPayload = Array.isArray(approvedPayload?.planning)
    ? approvedPayload.planning
    : null;
  if (
    approvedPlanningPayload &&
    fingerprintJiraState(
      approvedPlanningPayload.map(planningSourceProjection),
    ) !==
      fingerprintJiraState(currentPlanningPayload.map(planningSourceProjection))
  ) {
    throw new JiraRunnerError("plan_fingerprint_mismatch");
  }
  if (approvedPlanningPayload) {
    const approvedBySource = new Map(
      approvedPlanningPayload.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return [];
        }
        const record = value as Record<string, unknown>;
        const sourceIdentity = record.source_identity;
        if (
          !sourceIdentity ||
          typeof sourceIdentity !== "object" ||
          Array.isArray(sourceIdentity) ||
          typeof (sourceIdentity as Record<string, unknown>).key !== "string"
        ) {
          return [];
        }
        return [
          [
            (sourceIdentity as Record<string, unknown>).key as string,
            record,
          ] as const,
        ];
      }),
    );
    for (const action of planningActions) {
      const approved = approvedBySource.get(action.sourceIdentity.key);
      if (!approved) throw new JiraRunnerError("plan_fingerprint_mismatch");
      if (approved.classification === "reuse") {
        if (
          action.classification !== "reuse" ||
          action.targetId !== approved.target_id
        ) {
          throw new JiraRunnerError("plan_fingerprint_mismatch");
        }
        continue;
      }
      if (
        approved.classification === "create" &&
        canRecoverApprovedPlanningCreate(action, ledger)
      ) {
        continue;
      }
      if (
        approved.classification === "create" &&
        action.classification === "reuse" &&
        action.reason === "compatible_exact_name"
      ) {
        const claimed = await target.readPlanningClaim(action);
        if (claimed?.targetId === action.targetId) continue;
      }
      if (action.classification !== approved.classification) {
        throw new JiraRunnerError("plan_fingerprint_mismatch");
      }
    }
  }
  const planPayload = {
    control: {
      comment_catalog_complete: config.control.commentCatalogComplete === true,
    },
    source: {
      jira_cloud_id: config.jira.cloudId,
      project_keys: config.jira.projectKeys,
      projects: Object.fromEntries(
        [...projectDetailsByProject].map(([key, detail]) => [key, detail.raw]),
      ),
      board_ids: config.jira.boardIds,
      fields: fieldResult.raw,
      board_pages: Object.fromEntries(
        boardCatalogs.map(({ boardId, catalog }) => [boardId, catalog.pages]),
      ),
      version_pages: Object.fromEntries(versionPagesByProject),
      issue_pages: Object.fromEntries(issuePagesByProject),
      changelog_pages: Object.fromEntries(changelogPagesByIssue),
      related: Object.fromEntries(relatedSourceSnapshots),
    },
    target: {
      vault: config.target.vault,
      actor: targetPreflight.actor,
      endpoint_fingerprint: endpointFingerprint,
    },
    issue_ids: targetIdsByJiraKey,
    target_issue_preconditions: targetIssuePreconditions,
    absent_source_relations: absentSourceRelationPlan,
    planning: approvedPlanningPayload ?? currentPlanningPayload,
    issues: dryIssuePlans.map((plan) =>
      semanticIssuePlan(plan, approvedPlanningResolutions, planningActions),
    ),
    related_mapping: {
      accounts: accountMapping.accounts,
      link_mappings: Object.fromEntries(
        [...policies].map(([key, policy]) => [key, policy.linkMappings]),
      ),
    },
    comment_binding_preconditions:
      approvedCommentBindingPreconditions ??
      Object.fromEntries(
        allIssues.map((issue) => [
          issue.key,
          ledger.bindings
            .filter(
              (binding) =>
                binding.source_identity.entity_kind === "comment" &&
                binding.source_identity.jira_cloud_id === config.jira.cloudId &&
                binding.source_identity.issue_id === issue.id,
            )
            .sort((left, right) =>
              left.source_identity.key.localeCompare(right.source_identity.key),
            )
            .map((binding) => JiraMigrationBindingSchema.parse(binding)),
        ]),
      ),
    related_plan: relatedPlanningReports.map((item) => ({
      issue_key: item.issue_key,
      report: semanticRelatedReport(item.report),
    })),
    changelog: changelogPlans.map((plan) => ({
      source_identity: plan.sourceIdentity,
      source_fingerprint: plan.sourceFingerprint,
      report: plan.report,
      items: plan.items,
    })),
  };
  const planSha256 = fingerprintJiraState(planPayload);
  if (config.expectedPlanSha256 && config.expectedPlanSha256 !== planSha256) {
    throw new JiraRunnerError("plan_fingerprint_mismatch");
  }
  if (approvedReport && approvedReport.plan_sha256 !== planSha256) {
    throw new JiraRunnerError("plan_fingerprint_mismatch");
  }
  if (
    approvedPlanArtifact &&
    fingerprintJiraState(approvedPlanArtifact.payload) !== planSha256
  ) {
    throw new JiraRunnerError("plan_fingerprint_mismatch");
  }
  await writeJiraAccountMappingArtifact(
    paths.accountMappingPath,
    accountMapping,
  );
  ledger = openJiraMigrationRun(ledger, {
    runId: config.artifacts.runId,
    projectKeys: config.jira.projectKeys,
    planFingerprint: planSha256,
    at: runAt,
  });

  const terminalClassifications: JiraRunnerReport["terminal_classifications"] =
    [];
  const changelogFailureReasons = new Map<string, string>();
  const record = (
    phase: JiraMigrationPhase,
    result: JiraMigrationEntityResult,
  ) => {
    ledger = recordJiraMigrationResult(ledger, {
      runId: config.artifacts.runId,
      phase,
      result,
    });
    terminalClassifications.push({
      phase,
      source_key: result.source_key,
      action: result.action,
      retryable: result.retryable,
    });
  };
  const recordReportOnly = (
    phase: JiraRunnerReport["terminal_classifications"][number]["phase"],
    sourceKey: string,
    action: JiraMigrationAction,
    retryable = false,
  ): void => {
    terminalClassifications.push({
      phase,
      source_key: sourceKey,
      action,
      retryable,
    });
  };
  const changelogAction = (
    plan: JiraChangelogPlan,
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

  if (config.mode === "dry-run") {
    for (const action of planningActions) {
      assertNotAborted();
      record(
        "planning",
        resultFor({
          sourceKey: action.sourceIdentity.key,
          entityKind: action.sourceIdentity.kind,
          sourceFingerprint: sourceFingerprintForPlanning(action),
          mappedFingerprint: mappedFingerprintForPlanning(action),
          action: actionForPlanning(action.classification),
          at: runAt,
          readback: true,
        }),
      );
    }
    ledger = finalizeJiraMigrationPhase(ledger, {
      runId: config.artifacts.runId,
      phase: "planning",
      at: runAt,
    });
    for (const plan of dryIssuePlans) {
      assertNotAborted();
      const identity = jiraIssueSourceIdentity(
        plan.source.jiraCloudId,
        plan.source.projectId ?? plan.source.projectKey,
        plan.source.issueId,
      );
      let action = actionForIssuePlan(plan, ledger);
      let readbackSucceeded = false;
      if (plan.desired.issue && (action === "skip" || action === "update")) {
        const readback = await target
          .readIssue(plan.desired.issue.id)
          .catch(() => null);
        readbackSucceeded = readback !== null;
        const matches =
          action === "skip"
            ? baseIssueReadbackMatches(
                plan,
                readback,
                postRelatedContentByReefId.get(plan.desired.issue.id),
              )
            : issueOwnerMatches(plan, readback);
        if (!matches) action = "conflict";
      }
      record(
        "issues",
        resultFor({
          sourceKey: identity.key,
          entityKind: "issue",
          sourceFingerprint: fingerprintJiraState(
            allIssues.find((issue) => issue.id === plan.source.issueId)?.raw,
          ),
          mappedFingerprint: fingerprintJiraState(plan.desired),
          action,
          at: runAt,
          readback: readbackSucceeded,
        }),
      );
    }
    ledger = finalizeJiraMigrationPhase(ledger, {
      runId: config.artifacts.runId,
      phase: "issues",
      at: runAt,
    });
    for (const related of relatedPlanningReports) {
      recordReportOnly(
        "related",
        `related:${related.issue_key}`,
        actionForRelatedReport(related.report),
      );
    }
    for (const binding of absentSourceRelationPlan) {
      recordReportOnly(
        "related",
        `related:absent-source:${binding.source_key}`,
        "conflict",
      );
    }
    for (const plan of changelogPlans) {
      recordReportOnly(
        "changelog",
        plan.sourceIdentity.key,
        changelogAction(plan),
      );
    }
    ledger = finalizeJiraMigrationPhase(ledger, {
      runId: config.artifacts.runId,
      phase: "related",
      at: runAt,
    });
    for (const [index, deferred] of dryIssuePlans
      .flatMap((plan) => plan.deferred.map((item) => ({ plan, item })))
      .entries()) {
      const relatedReport = finalRelatedReports.find(
        (candidate) => candidate.issue_key === deferred.plan.source.issueKey,
      )?.report;
      recordReportOnly(
        "reconciliation",
        `reconciliation:${deferred.plan.source.issueKey}:${index}`,
        reconciliationAction(
          deferred.item,
          relatedReport,
          approvedPlanningResolutions,
        ),
      );
    }
    ledger = finalizeJiraMigrationPhase(ledger, {
      runId: config.artifacts.runId,
      phase: "reconciliation",
      at: runAt,
    });
    await persistLedger(ledger);
  } else {
    let confirmed = 0;
    const checkpoint = async (): Promise<void> => {
      await persistLedger(ledger);
      confirmed += 1;
      if (
        dependencies.failAfterConfirmedEntities !== undefined &&
        confirmed >= dependencies.failAfterConfirmedEntities
      ) {
        throw new JiraRunnerError("failpoint");
      }
    };
    const planningResolutions: JiraPlanningTargetResolution[] = [];
    for (const action of planningActions) {
      assertNotAborted();
      const sourceFingerprint = sourceFingerprintForPlanning(action);
      const mappedFingerprint = mappedFingerprintForPlanning(action);
      if (
        action.classification === "conflict" ||
        action.classification === "unsupported"
      ) {
        record(
          "planning",
          resultFor({
            sourceKey: action.sourceIdentity.key,
            entityKind: action.sourceIdentity.kind,
            sourceFingerprint,
            mappedFingerprint,
            action: "conflict",
            at: now(),
            readback: true,
          }),
        );
        await checkpoint();
        continue;
      }
      let resolution: JiraPlanningTargetResolution;
      try {
        resolution = await target.applyPlanning(action);
      } catch (error) {
        assertNotAborted();
        const deterministicConflict =
          error instanceof JiraTargetConflictError ||
          (error instanceof Error &&
            new Set([
              "jira_planning_conflict",
              "jira_planning_unsupported",
              "jira_planning_target_missing",
              "target_planning_readback_failed",
            ]).has(error.message));
        record(
          "planning",
          resultFor({
            sourceKey: action.sourceIdentity.key,
            entityKind: action.sourceIdentity.kind,
            sourceFingerprint,
            mappedFingerprint,
            action: deterministicConflict ? "conflict" : "failed",
            at: now(),
            readback: false,
            retryable: !deterministicConflict,
            ...(deterministicConflict
              ? {}
              : {
                  reconciliationState: "pending_target_migration" as const,
                }),
          }),
        );
        await checkpoint();
        continue;
      }
      if (
        !planningResolutions.some(
          (candidate) =>
            candidate.sourceIdentity.key === resolution.sourceIdentity.key,
        )
      ) {
        planningResolutions.push(resolution);
      }
      ledger = confirmJiraMigrationBinding(ledger, {
        sourceIdentity: action.sourceIdentity,
        target: {
          target_kind: resolution.targetKind,
          target_id: resolution.targetId,
        },
        sourceFingerprint,
        mappedStateFingerprint: mappedFingerprint,
        lastAppliedAt: now(),
        writeSucceeded: true,
        readbackSucceeded: true,
      });
      record(
        "planning",
        resultFor({
          sourceKey: action.sourceIdentity.key,
          entityKind: action.sourceIdentity.kind,
          sourceFingerprint,
          mappedFingerprint,
          action: action.classification === "reuse" ? "skip" : "create",
          at: now(),
          readback: true,
        }),
      );
      await checkpoint();
    }
    ledger = finalizeJiraMigrationPhase(ledger, {
      runId: config.artifacts.runId,
      phase: "planning",
      at: now(),
    });
    await persistLedger(ledger);

    const applyIssuePlans = buildIssuePlans(planningResolutions);
    const approvedIssueFingerprints = new Map(
      dryIssuePlans.map((plan) => [
        plan.source.issueKey,
        fingerprintJiraState(
          semanticIssuePlan(plan, approvedPlanningResolutions, planningActions),
        ),
      ]),
    );
    const recoverAppliedIssue = async (
      plan: JiraIssueImportPlan,
    ): Promise<{
      applied: Awaited<ReturnType<AkbJiraMigrationTarget["applyIssue"]>> | null;
      readbackFound: boolean;
    }> => {
      const desired = plan.desired.issue;
      const readback = desired
        ? await target.readIssue(desired.id).catch(() => null)
        : null;
      if (
        !desired ||
        !readback ||
        !baseIssueReadbackMatches(
          plan,
          readback,
          postRelatedContentByReefId.get(desired.id),
        )
      ) {
        return { applied: null, readbackFound: readback !== null };
      }
      return {
        applied: {
          reefId: desired.id,
          documentUri: `akb://${config.target.vault}/coll/issues/doc/${desired.id.toLowerCase()}.md`,
          commitHash: readback.commit_hash ?? "",
        },
        readbackFound: true,
      };
    };
    const failedIssueClaimIds = new Set<string>();
    const conflictedIssueClaimIds = new Set<string>();
    for (const plan of applyIssuePlans) {
      assertNotAborted();
      if (
        actionForIssuePlan(plan, ledger) !== "create" ||
        fingerprintJiraState(
          semanticIssuePlan(plan, planningResolutions, planningActions),
        ) !== approvedIssueFingerprints.get(plan.source.issueKey)
      ) {
        continue;
      }
      try {
        await target.claimIssue(plan);
      } catch (error) {
        const reefId = plan.desired.issue?.id;
        if (reefId) {
          if (error instanceof JiraTargetConflictError) {
            conflictedIssueClaimIds.add(reefId);
          } else {
            failedIssueClaimIds.add(reefId);
          }
        }
      }
    }
    const issueReferences = (plan: JiraIssueImportPlan): string[] => {
      const desired = plan.desired.issue;
      return desired
        ? [
            desired.parent_id,
            ...(desired.depends_on ?? []),
            ...(desired.blocks ?? []),
            ...(desired.related_to ?? []),
          ].filter((id): id is string => typeof id === "string")
        : [];
    };
    let blockedClaimCount = -1;
    while (
      blockedClaimCount !==
      failedIssueClaimIds.size + conflictedIssueClaimIds.size
    ) {
      blockedClaimCount =
        failedIssueClaimIds.size + conflictedIssueClaimIds.size;
      for (const plan of applyIssuePlans) {
        if (actionForIssuePlan(plan, ledger) !== "create") continue;
        const reefId = plan.desired.issue?.id;
        if (!reefId) continue;
        const references = issueReferences(plan);
        if (references.some((id) => conflictedIssueClaimIds.has(id))) {
          conflictedIssueClaimIds.add(reefId);
        } else if (references.some((id) => failedIssueClaimIds.has(id))) {
          failedIssueClaimIds.add(reefId);
        }
      }
    }
    const confirmedIssueSourceKeys = new Set<string>();
    for (const plan of applyIssuePlans) {
      assertNotAborted();
      const identity = jiraIssueSourceIdentity(
        plan.source.jiraCloudId,
        plan.source.projectId ?? plan.source.projectKey,
        plan.source.issueId,
      );
      const sourceFingerprint = fingerprintJiraState(
        allIssues.find((issue) => issue.id === plan.source.issueId)?.raw,
      );
      const mappedFingerprint = fingerprintJiraState(plan.desired);
      if (
        fingerprintJiraState(
          semanticIssuePlan(plan, planningResolutions, planningActions),
        ) !== approvedIssueFingerprints.get(plan.source.issueKey)
      ) {
        record(
          "issues",
          resultFor({
            sourceKey: identity.key,
            entityKind: "issue",
            sourceFingerprint,
            mappedFingerprint,
            action: "conflict",
            at: now(),
            readback: false,
          }),
        );
        await checkpoint();
        continue;
      }
      const action = actionForIssuePlan(plan, ledger);
      if (action === "conflict") {
        record(
          "issues",
          resultFor({
            sourceKey: identity.key,
            entityKind: "issue",
            sourceFingerprint,
            mappedFingerprint,
            action: "conflict",
            at: now(),
            readback: true,
          }),
        );
        await checkpoint();
        continue;
      }
      const claimBlocked =
        (action === "create" &&
          Boolean(
            plan.desired.issue &&
              failedIssueClaimIds.has(plan.desired.issue.id),
          )) ||
        (action === "update" &&
          issueReferences(plan).some((id) => failedIssueClaimIds.has(id)));
      const claimConflicted =
        (action === "create" &&
          Boolean(
            plan.desired.issue &&
              conflictedIssueClaimIds.has(plan.desired.issue.id),
          )) ||
        (action === "update" &&
          issueReferences(plan).some((id) => conflictedIssueClaimIds.has(id)));
      if (claimConflicted) {
        record(
          "issues",
          resultFor({
            sourceKey: identity.key,
            entityKind: "issue",
            sourceFingerprint,
            mappedFingerprint,
            action: "conflict",
            at: now(),
            readback: true,
            retryable: false,
          }),
        );
        await checkpoint();
        continue;
      }
      if (claimBlocked) {
        record(
          "issues",
          resultFor({
            sourceKey: identity.key,
            entityKind: "issue",
            sourceFingerprint,
            mappedFingerprint,
            action: "failed",
            at: now(),
            readback: false,
            retryable: true,
            reconciliationState: "pending_target_migration",
          }),
        );
        await checkpoint();
        continue;
      }
      if (action === "skip") {
        const desired = plan.desired.issue;
        let readback: Awaited<
          ReturnType<AkbJiraMigrationTarget["readIssue"]>
        > | null = null;
        if (desired) {
          try {
            readback = await target.readIssue(desired.id);
          } catch {
            record(
              "issues",
              resultFor({
                sourceKey: identity.key,
                entityKind: "issue",
                sourceFingerprint,
                mappedFingerprint,
                action: "failed",
                at: now(),
                readback: false,
                retryable: true,
                reconciliationState: "pending_target_migration",
              }),
            );
            await checkpoint();
            continue;
          }
        }
        if (
          !baseIssueReadbackMatches(
            plan,
            readback,
            desired ? postRelatedContentByReefId.get(desired.id) : undefined,
          )
        ) {
          record(
            "issues",
            resultFor({
              sourceKey: identity.key,
              entityKind: "issue",
              sourceFingerprint,
              mappedFingerprint,
              action: "conflict",
              at: now(),
              readback: Boolean(readback),
              retryable: false,
            }),
          );
          await checkpoint();
          continue;
        }
        confirmedIssueSourceKeys.add(identity.key);
        record(
          "issues",
          resultFor({
            sourceKey: identity.key,
            entityKind: "issue",
            sourceFingerprint,
            mappedFingerprint,
            action: "skip",
            at: now(),
            readback: true,
          }),
        );
        await checkpoint();
        continue;
      }
      let applied:
        | Awaited<ReturnType<AkbJiraMigrationTarget["applyIssue"]>>
        | undefined;
      let approvedUpdateReadback:
        | Awaited<ReturnType<AkbJiraMigrationTarget["readIssue"]>>
        | undefined;
      if (action === "update") {
        const desired = plan.desired.issue;
        const current = desired
          ? await target.readIssue(desired.id).catch(() => null)
          : null;
        if (
          desired &&
          baseIssueReadbackMatches(
            plan,
            current,
            postRelatedContentByReefId.get(desired.id),
          )
        ) {
          applied = {
            reefId: desired.id,
            documentUri: `akb://${config.target.vault}/coll/issues/doc/${desired.id.toLowerCase()}.md`,
            commitHash: current?.commit_hash ?? "",
          };
        } else if (
          issueReadbackApprovalFingerprint(plan, current) !==
          targetIssuePreconditions[plan.source.issueKey]
        ) {
          record(
            "issues",
            resultFor({
              sourceKey: identity.key,
              entityKind: "issue",
              sourceFingerprint,
              mappedFingerprint,
              action: "conflict",
              at: now(),
              readback: current !== null,
              retryable: false,
            }),
          );
          await checkpoint();
          continue;
        } else if (current) {
          approvedUpdateReadback = current;
        }
      }
      try {
        applied ??= await target.applyIssue(
          plan,
          action,
          approvedUpdateReadback,
        );
      } catch (error) {
        const recovered = await recoverAppliedIssue(plan);
        if (!recovered.applied) {
          const conflict = error instanceof JiraTargetConflictError;
          record(
            "issues",
            resultFor({
              sourceKey: identity.key,
              entityKind: "issue",
              sourceFingerprint,
              mappedFingerprint,
              action: conflict ? "conflict" : "failed",
              at: now(),
              readback: recovered.readbackFound,
              retryable: !conflict,
              ...(conflict
                ? {}
                : {
                    reconciliationState: "pending_target_migration" as const,
                  }),
            }),
          );
          await checkpoint();
          continue;
        }
        applied = recovered.applied;
      }
      if (!applied) throw new Error("target_issue_apply_unresolved");
      ledger = confirmJiraMigrationBinding(ledger, {
        sourceIdentity: identity,
        target: {
          target_kind: "issue",
          reef_id: applied.reefId,
          document_uri: applied.documentUri,
        },
        sourceFingerprint,
        mappedStateFingerprint: mappedFingerprint,
        lastAppliedAt: now(),
        writeSucceeded: true,
        readbackSucceeded: true,
        rawArchiveReference: archiveReferences.get(plan.source.issueKey)?.issue,
      });
      confirmedIssueSourceKeys.add(identity.key);
      record(
        "issues",
        resultFor({
          sourceKey: identity.key,
          entityKind: "issue",
          sourceFingerprint,
          mappedFingerprint,
          action,
          at: now(),
          readback: true,
        }),
      );
      await checkpoint();
    }
    ledger = finalizeJiraMigrationPhase(ledger, {
      runId: config.artifacts.runId,
      phase: "issues",
      at: now(),
    });
    const confirmedIssueBinding = (issue: NormalizedJiraIssue): boolean => {
      const identity = jiraIssueSourceIdentity(
        config.jira.cloudId,
        projectId(issue),
        issue.id,
      );
      const binding = ledger.bindings.find(
        (candidate) => candidate.source_key === identity.key,
      );
      return (
        confirmedIssueSourceKeys.has(identity.key) &&
        binding?.target.target_kind === "issue" &&
        binding.target.reef_id === targetIdsByJiraKey[issue.key]
      );
    };
    const relatedApplyReports: typeof relatedPlanningReports = [];
    for (const issue of allIssues) {
      assertNotAborted();
      if (!confirmedIssueBinding(issue)) {
        const planned = relatedPlanningReports.find(
          (candidate) => candidate.issue_key === issue.key,
        );
        const report = {
          ...planned?.report,
          mode: "apply" as const,
          failures: [
            ...(planned?.report.failures ?? []),
            {
              source_kind: "link" as const,
              source_id: issue.id,
              phase: "resolve" as const,
              retryable: false,
              reason: "parent_issue_not_confirmed",
            },
          ],
        } as JiraRelatedImportReport;
        relatedApplyReports.push({ issue_key: issue.key, report });
        recordReportOnly("related", `related:${issue.key}`, "conflict");
        await checkpoint();
        continue;
      }
      const key = issue.projectKey ?? issue.key.split("-")[0] ?? "";
      const client = clients.get(key);
      const policy = policies.get(key);
      if (!client || !policy) throw new Error("jira_client_missing");
      let result: Awaited<ReturnType<typeof importJiraRelatedData>>;
      try {
        result = await importJiraRelatedData({
          jiraCloudId: config.jira.cloudId,
          issue: issue.raw,
          reefId: targetIdsByJiraKey[issue.key] as string,
          client,
          target: target.relatedTarget(),
          ledger,
          accountMapping,
          linkMappings: policy.linkMappings,
          attachmentPolicy: config.control.commentCatalogComplete
            ? {
                maxBytes: 20 * 1024 * 1024,
                commentVisibilityCompleteness: "verified" as const,
                ...(approvedCommentBindingPreconditions
                  ? {
                      approvedCommentBindings: approvedCommentBindings(
                        issue.key,
                      ),
                      approvedCommentBindingsAppliedAfter: runAt,
                    }
                  : {}),
              }
            : undefined,
          resolveIssueTarget(sourceIdOrKey) {
            const peer = allIssues.find(
              (candidate) =>
                candidate.id === sourceIdOrKey ||
                candidate.key === sourceIdOrKey,
            );
            const reefId = peer ? issueBindings[sourceIdOrKey] : undefined;
            return peer && confirmedIssueBinding(peer) && reefId
              ? {
                  reefId,
                  documentUri: `akb://${config.target.vault}/coll/issues/doc/${reefId.toLowerCase()}.md`,
                }
              : null;
          },
          mode: "apply",
          now,
          async checkpointLedger(attachmentLedger) {
            ledger = attachmentLedger;
            await checkpoint();
          },
        });
      } catch (relatedError) {
        if (
          typeof relatedError !== "object" ||
          relatedError === null ||
          !("retryable" in relatedError) ||
          relatedError.retryable !== true
        ) {
          throw relatedError;
        }
        const failureReason = safeMigrationFailureReason(
          relatedError,
          "related_import_failed",
        );
        const report = {
          ...relatedPlanningReports.find(
            (candidate) => candidate.issue_key === issue.key,
          )?.report,
          mode: "apply" as const,
          failures: [
            ...(relatedPlanningReports.find(
              (candidate) => candidate.issue_key === issue.key,
            )?.report.failures ?? []),
            {
              source_kind: "link" as const,
              source_id: issue.id,
              phase: "write" as const,
              retryable: true,
              reason: failureReason,
            },
          ],
        } as JiraRelatedImportReport;
        relatedApplyReports.push({ issue_key: issue.key, report });
        recordReportOnly("related", `related:${issue.key}`, "failed", true);
        await checkpoint();
        continue;
      }
      ledger = result.ledger;
      relatedApplyReports.push({ issue_key: issue.key, report: result.report });
      recordReportOnly(
        "related",
        `related:${issue.key}`,
        actionForRelatedReport(result.report),
        result.report.failures.some((failure) => failure.retryable),
      );
      await checkpoint();
    }
    finalRelatedReports = relatedApplyReports;
    for (const plannedBinding of absentSourceRelationPlan) {
      assertNotAborted();
      const binding = ledger.bindings.find(
        (candidate) => candidate.source_key === plannedBinding.source_key,
      );
      const classificationKey = `related:absent-source:${plannedBinding.source_key}`;
      if (!binding) {
        recordReportOnly("related", classificationKey, "skip");
        await checkpoint();
        continue;
      }
      if (binding.target.target_kind !== "relation") {
        recordReportOnly("related", classificationKey, "conflict");
        await checkpoint();
        continue;
      }
      if (
        plannedBinding.target === null ||
        binding.target.idempotency_key !== plannedBinding.target
      ) {
        recordReportOnly("related", classificationKey, "conflict");
        await checkpoint();
        continue;
      }
      // Enhanced JQL absence cannot distinguish deletion from issue-security,
      // credential, or project-scope changes. Preserve the owned relation until
      // a future source contract can prove deletion authoritatively.
      recordReportOnly("related", classificationKey, "conflict");
      await checkpoint();
    }
    for (const plan of changelogPlans) {
      assertNotAborted();
      const parentIssue = allIssues.find(
        (issue) => issue.id === plan.sourceIdentity.issue_id,
      );
      if (!parentIssue || !confirmedIssueBinding(parentIssue)) {
        recordReportOnly("changelog", plan.sourceIdentity.key, "conflict");
        await checkpoint();
        continue;
      }
      let action = changelogAction(plan);
      const existingBinding = ledger.bindings.find(
        (candidate) => candidate.source_key === plan.sourceIdentity.key,
      );
      const bindingMatchesSource =
        existingBinding?.source_fingerprint === plan.sourceFingerprint;
      const bindingUsesCurrentFingerprint =
        bindingMatchesSource &&
        existingBinding.mapped_state_fingerprint ===
          mappedFingerprintForChangelog(plan);
      const bindingUsesLegacyFingerprint =
        bindingMatchesSource &&
        existingBinding.mapped_state_fingerprint ===
          legacyMappedFingerprintForChangelog(plan);
      if (
        action !== "conflict" &&
        (bindingUsesCurrentFingerprint || bindingUsesLegacyFingerprint)
      ) {
        const activities = plan.items.flatMap((item) =>
          item.activity ? [item.activity] : [],
        );
        let readbackMatches = await target.activityMatches(activities);
        for (const item of plan.items) {
          if (!readbackMatches || !item.externalRef) continue;
          const idempotencyKey = `${plan.sourceIdentity.key}:${item.itemIndex}`;
          const provenance = {
            jira_cloud_id: config.jira.cloudId,
            issue_id: plan.sourceIdentity.issue_id,
            history_id: plan.sourceIdentity.history_id,
            item_index: item.itemIndex,
          };
          const readback = await target
            .relatedTarget()
            .readExternalRef(idempotencyKey);
          readbackMatches =
            readback !== null &&
            fingerprintJiraState(readback) ===
              fingerprintJiraState({
                reefId: issueBindings[plan.sourceIdentity.issue_id] as string,
                ref: item.externalRef,
                provenance,
              });
        }
        if (readbackMatches) {
          if (bindingUsesLegacyFingerprint) {
            ledger = confirmJiraMigrationBinding(ledger, {
              sourceIdentity: plan.sourceIdentity,
              target: existingBinding.target,
              sourceFingerprint: plan.sourceFingerprint,
              mappedStateFingerprint: mappedFingerprintForChangelog(plan),
              lastAppliedAt: now(),
              writeSucceeded: true,
              readbackSucceeded: true,
              rawArchiveReference: plan.rawArchiveReference,
            });
          }
          action = "skip";
        } else {
          action = "create";
        }
      }
      if (action === "create") {
        let failed = false;
        const activities = plan.items.flatMap((item) =>
          item.activity ? [item.activity] : [],
        );
        try {
          if (activities.length > 0) {
            await target.appendActivity(activities);
          }
        } catch (changelogError) {
          if (
            changelogError instanceof JiraRunnerError ||
            dependencies.signal?.aborted
          ) {
            throw changelogError;
          }
          changelogFailureReasons.set(
            plan.sourceIdentity.key,
            safeMigrationFailureReason(
              changelogError,
              "changelog_target_failure",
            ),
          );
          failed = true;
        }
        for (const item of failed ? [] : plan.items) {
          try {
            if (item.externalRef) {
              const idempotencyKey = `${plan.sourceIdentity.key}:${item.itemIndex}`;
              const provenance = {
                jira_cloud_id: config.jira.cloudId,
                issue_id: plan.sourceIdentity.issue_id,
                history_id: plan.sourceIdentity.history_id,
                item_index: item.itemIndex,
              };
              await target.relatedTarget().putExternalRef({
                idempotencyKey,
                reefId: issueBindings[plan.sourceIdentity.issue_id] as string,
                ref: item.externalRef,
                provenance,
              });
              const readback = await target
                .relatedTarget()
                .readExternalRef(idempotencyKey);
              if (
                !readback ||
                fingerprintJiraState(readback) !==
                  fingerprintJiraState({
                    reefId: issueBindings[
                      plan.sourceIdentity.issue_id
                    ] as string,
                    ref: item.externalRef,
                    provenance,
                  })
              ) {
                throw new Error("target_external_ref_readback_failed");
              }
            }
          } catch (changelogError) {
            if (
              changelogError instanceof JiraRunnerError ||
              dependencies.signal?.aborted
            ) {
              throw changelogError;
            }
            changelogFailureReasons.set(
              plan.sourceIdentity.key,
              safeMigrationFailureReason(
                changelogError,
                "changelog_target_failure",
              ),
            );
            failed = true;
          }
        }
        if (failed) {
          recordReportOnly("changelog", plan.sourceIdentity.key, "failed");
          await checkpoint();
          continue;
        }
        ledger = confirmJiraMigrationBinding(ledger, {
          sourceIdentity: plan.sourceIdentity,
          target: {
            target_kind: "changelog_history",
            idempotency_key: plan.sourceIdentity.key,
          },
          sourceFingerprint: plan.sourceFingerprint,
          mappedStateFingerprint: mappedFingerprintForChangelog(plan),
          lastAppliedAt: now(),
          writeSucceeded: true,
          readbackSucceeded: true,
          rawArchiveReference: plan.rawArchiveReference,
        });
      }
      recordReportOnly("changelog", plan.sourceIdentity.key, action);
      await checkpoint();
    }
    ledger = finalizeJiraMigrationPhase(ledger, {
      runId: config.artifacts.runId,
      phase: "related",
      at: now(),
    });
    for (const [index, deferred] of dryIssuePlans
      .flatMap((plan) => plan.deferred.map((item) => ({ plan, item })))
      .entries()) {
      const relatedReport = finalRelatedReports.find(
        (candidate) => candidate.issue_key === deferred.plan.source.issueKey,
      )?.report;
      recordReportOnly(
        "reconciliation",
        `reconciliation:${deferred.plan.source.issueKey}:${index}`,
        reconciliationAction(deferred.item, relatedReport, planningResolutions),
      );
      await checkpoint();
    }
    ledger = finalizeJiraMigrationPhase(ledger, {
      runId: config.artifacts.runId,
      phase: "reconciliation",
      at: now(),
    });
    await persistLedger(ledger);
  }

  assertNotAborted();
  const report = buildJiraRunnerReport({
    runId: config.artifacts.runId,
    mode: config.mode,
    source: {
      jira_cloud_id: config.jira.cloudId,
      project_keys: config.jira.projectKeys,
      board_ids: config.jira.boardIds,
    },
    target: { vault: config.target.vault, actor: targetPreflight.actor },
    planSha256,
    startedAt: runAt,
    endedAt: now(),
    status: terminalClassifications.some(
      (classification) => classification.action === "conflict",
    )
      ? "blocked"
      : terminalClassifications.some(
            (classification) => classification.action === "failed",
          )
        ? "partial_failed"
        : "completed",
    sections: {
      planning: planningActions.map(safePlanningAction),
      issues: dryIssuePlans.map((plan) => ({
        source: plan.source,
        status: plan.status,
        field_results: plan.field_results,
        deferred: plan.deferred,
      })),
      related: finalRelatedReports,
      changelog: changelogPlans.map((plan) => ({
        source_identity: plan.sourceIdentity,
        report: plan.report,
        failure_reason:
          changelogFailureReasons.get(plan.sourceIdentity.key) ?? null,
      })),
      reconciliation: [
        ...dryIssuePlans.flatMap((plan) => plan.deferred),
        ...absentSourceRelationPlan.map((binding) => ({
          kind: "relation",
          reason: "source_issue_absent",
          source_key: binding.source_key,
        })),
      ],
      raw_archive: [
        ...archiveSummaries,
        {
          account_mapping: {
            jira_cloud_id: accountReport.jiraCloudId,
            total: accountReport.users.length,
            fallback_actors: accountReport.users
              .filter((user) => user.mappingStrategy === "fallback")
              .map((user) => ({
                account_id: user.accountId,
                actor: user.actor,
                project_keys: user.projectKeys,
              })),
            changes: {
              added: accountReport.changes.added.length,
              changed: accountReport.changes.changed.length,
              unchanged: accountReport.changes.unchanged.length,
            },
          },
        },
      ],
    },
    terminalClassifications,
    inputCount:
      planningActions.length +
      dryIssuePlans.length +
      relatedPlanningReports.length +
      absentSourceRelationPlan.length +
      changelogPlans.length +
      dryIssuePlans.reduce((total, plan) => total + plan.deferred.length, 0),
    ...(approvedReport
      ? {
          approvedDryRun: {
            planSha256: approvedReport.approval.dry_run_plan_sha256,
            completedAt: approvedReport.approval.dry_run_completed_at,
          },
        }
      : {}),
  });
  const outputReportPath = paths.reportPath;
  const expectedReport = (await fileExists(outputReportPath))
    ? await loadJiraRunnerReport(outputReportPath)
    : undefined;
  if (config.mode === "dry-run" && report.run.status === "completed") {
    const approvalPath = `${paths.reportPath}.approval.json`;
    let approvalReport = report;
    if (await fileExists(approvalPath)) {
      const existingApproval = await loadJiraRunnerReport(approvalPath);
      const sameApproval =
        fingerprintJiraState(approvalRelevantReport(existingApproval)) ===
        fingerprintJiraState(approvalRelevantReport(report));
      if (!sameApproval) {
        throw new JiraRunnerError("dry_run_scope_mismatch");
      }
      approvalReport = existingApproval;
    } else {
      await writeJiraRunnerReport({
        path: approvalPath,
        report,
        forbiddenSecretValues: secretValuesForConfig(config),
      });
    }
    await writePrivatePlanArtifact(`${paths.reportPath}.plan.json`, {
      schema_version: 1,
      run_id: config.artifacts.runId,
      source: {
        jira_cloud_id: config.jira.cloudId,
        project_keys: config.jira.projectKeys,
        board_ids: config.jira.boardIds,
        endpoint_fingerprint: sourceEndpointFingerprint,
      },
      target: {
        vault: config.target.vault,
        actor: targetPreflight.actor,
        endpoint_fingerprint: endpointFingerprint,
      },
      plan_sha256: planSha256,
      approval_report_sha256: fingerprintJiraState(approvalReport),
      payload: planPayload,
    });
  }
  await writeJiraRunnerReport({
    path: outputReportPath,
    report,
    ...(expectedReport ? { expectedReport } : {}),
    forbiddenSecretValues: secretValuesForConfig(config),
  });
  return {
    runId: config.artifacts.runId,
    mode: config.mode,
    planSha256,
    report,
    ledger,
  };
}

export async function runJiraMigration(
  config: JiraMigratorConfig,
  dependencies: JiraRunnerDependencies = {},
): Promise<JiraRunnerResult> {
  const paths = requireArtifactPaths(config);
  for (const directory of new Set([
    dirname(paths.ledgerPath),
    dirname(paths.reportPath),
    dirname(paths.accountMappingPath),
    paths.archiveRoot,
  ])) {
    await ensurePrivateDirectory(directory);
  }
  const lockIdentity = fingerprintJiraState({
    run_id: config.artifacts.runId,
    source: {
      endpoint: jiraEndpointFingerprint(config.jira.baseUrl),
      cloud_id: config.jira.cloudId,
      project_keys: [...config.jira.projectKeys].sort(),
    },
    target: {
      endpoint: targetEndpointFingerprint(config.target.baseUrl),
      vault: config.target.vault,
    },
  });
  const lockPath = join(
    await realpath(tmpdir()),
    `reef-jira-migrator-locks-${createHash("sha256")
      .update(
        typeof process.getuid === "function"
          ? String(process.getuid())
          : userInfo().username,
      )
      .digest("hex")
      .slice(0, 16)}`,
    `${lockIdentity}.lock`,
  );
  const lockPaths = [
    ...new Set([`${paths.ledgerPath}.run.lock`, lockPath]),
  ].sort((left, right) => left.localeCompare(right));
  const releases: Array<() => Promise<void>> = [];
  let ownsRunArtifacts = false;
  try {
    for (const path of lockPaths) {
      await ensurePrivateDirectory(dirname(path));
      releases.push(await acquireMigrationRunLock(path));
    }
    ownsRunArtifacts = true;
    return await runJiraMigrationUnlocked(config, dependencies);
  } finally {
    if (ownsRunArtifacts) {
      await rm(
        join(
          paths.archiveRoot,
          ".spool",
          privateSpoolSegment(config.artifacts.runId),
        ),
        { recursive: true, force: true },
      ).catch(() => undefined);
    }
    for (const release of releases.reverse()) {
      await release();
    }
  }
}
