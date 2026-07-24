import { readFile } from "node:fs/promises";
import { writeJiraAccountMappingArtifact } from "../accounts/artifactFile.js";
import type { JiraMigratorConfig } from "../cli/config.js";
import { fingerprintJiraState } from "../execution/diff.js";
import {
  type JiraChangelogPlan,
  buildJiraChangelogPlan,
} from "../issues/changelog.js";
import type { JiraIssueImportPlan } from "../issues/importPlan.js";
import { buildJiraIssueImportPlan } from "../issues/mapping.js";
import type { JiraReadClient } from "../jira/client.js";
import {
  JiraMigrationBindingSchema,
  type JiraMigrationLedgerV1,
  getJiraPlanningLedgerBindings,
  jiraAttachmentSourceIdentity,
  openJiraMigrationRun,
} from "../ledger.js";
import {
  type JiraIssuePayload,
  normalizeIssueSprintReferences,
} from "../payloads.js";
import {
  type JiraPlanningTargetResolution,
  buildJiraPlanningMigrationPlan,
  buildJiraPlanningTargetMappings,
} from "../planning/entities.js";
import type {
  JiraRelatedOperation,
  JiraRelatedOperationKind,
} from "../related/contracts.js";
import {
  type JiraRelatedImportReport,
  importJiraRelatedData,
} from "../related/import.js";
import { rewriteMedia } from "../related/media.js";
import { sameRelatedOperation } from "../related/operations.js";
import { reportTemplate } from "../related/reporting.js";
import {
  canRecoverApprovedPlanningCreate,
  issueReadbackApprovalFingerprint,
  planningResolutionsForApproval,
  planningSourceProjection,
  safePlanningAction,
  semanticIssuePlan,
  semanticRelatedReport,
} from "./approval.js";
import type { JiraApprovalArtifacts } from "./approvalArtifacts.js";
import { actionForIssuePlan, mergePlanningActions } from "./decisions.js";
import { JiraRunnerError } from "./errors.js";
import type { LoadedJiraMappingPolicy } from "./mappingPolicy.js";
import type { archiveJiraMigrationSource } from "./sourceArchive.js";
import type { discoverJiraMigrationSource } from "./sourceDiscovery.js";
import {
  type RelatedSourceSnapshot,
  getRelatedBinarySpools,
} from "./sourceSnapshot.js";
import type { AkbJiraMigrationTarget } from "./targetAdapter.js";

export const relatedPlanForApproval = (
  approvedPayload: Record<string, unknown> | null,
  relatedPlanningReports: readonly {
    issue_key: string;
    report: JiraRelatedImportReport;
  }[],
): unknown[] =>
  Array.isArray(approvedPayload?.related_plan)
    ? approvedPayload.related_plan
    : relatedPlanningReports.map((item) => ({
        issue_key: item.issue_key,
        report: semanticRelatedReport(item.report),
      }));

const relatedOperationKinds = new Set<JiraRelatedOperationKind>([
  "create_comment",
  "update_comment",
  "delete_comment",
  "create_attachment",
  "revoke_attachment",
  "update_description",
  "put_relation",
  "delete_relation",
  "put_external_ref",
  "delete_external_ref",
]);

const parseRelatedOperations = (value: unknown): JiraRelatedOperation[] => {
  if (!Array.isArray(value))
    throw new JiraRunnerError("plan_fingerprint_mismatch");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new JiraRunnerError("plan_fingerprint_mismatch");
    }
    const operation = item as Record<string, unknown>;
    if (
      typeof operation.kind !== "string" ||
      !relatedOperationKinds.has(operation.kind as JiraRelatedOperationKind) ||
      typeof operation.key_sha256 !== "string" ||
      typeof operation.input_sha256 !== "string"
    ) {
      throw new JiraRunnerError("plan_fingerprint_mismatch");
    }
    return {
      kind: operation.kind as JiraRelatedOperationKind,
      key_sha256: operation.key_sha256,
      input_sha256: operation.input_sha256,
    };
  });
};

const relatedOperationsByIssue = (
  relatedPlan: readonly unknown[],
): Map<string, JiraRelatedOperation[]> =>
  new Map(
    relatedPlan.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new JiraRunnerError("plan_fingerprint_mismatch");
      }
      const item = value as Record<string, unknown>;
      const report =
        item.report &&
        typeof item.report === "object" &&
        !Array.isArray(item.report)
          ? (item.report as Record<string, unknown>)
          : null;
      if (typeof item.issue_key !== "string" || !report) {
        throw new JiraRunnerError("plan_fingerprint_mismatch");
      }
      return [
        item.issue_key,
        parseRelatedOperations(report.operations),
      ] as const;
    }),
  );

export const assertRelatedOperationSubset = (
  approved: readonly JiraRelatedOperation[],
  current: readonly JiraRelatedOperation[],
): void => {
  let approvedIndex = 0;
  for (const operation of current) {
    const relativeIndex = approved
      .slice(approvedIndex)
      .findIndex((candidate) => sameRelatedOperation(candidate, operation));
    if (relativeIndex < 0) {
      throw new JiraRunnerError("plan_fingerprint_mismatch");
    }
    approvedIndex += relativeIndex + 1;
  }
};

export async function buildJiraMigrationPlan(input: {
  config: JiraMigratorConfig;
  accountMappingPath: string;
  endpointFingerprint: string;
  runAt: string;
  ledger: JiraMigrationLedgerV1;
  target: AkbJiraMigrationTarget;
  targetPreflight: Awaited<ReturnType<AkbJiraMigrationTarget["preflight"]>>;
  clients: ReadonlyMap<string, JiraReadClient>;
  policies: ReadonlyMap<string, LoadedJiraMappingPolicy>;
  relatedSourceSnapshots: Map<string, RelatedSourceSnapshot>;
  discovery: Awaited<ReturnType<typeof discoverJiraMigrationSource>>;
  archive: Awaited<ReturnType<typeof archiveJiraMigrationSource>>;
  approval: JiraApprovalArtifacts;
}) {
  const {
    config,
    accountMappingPath,
    endpointFingerprint,
    runAt,
    target,
    targetPreflight,
    clients,
    policies,
    relatedSourceSnapshots,
    discovery,
    archive,
    approval,
  } = input;
  let ledger = input.ledger;
  const {
    fieldResult,
    fieldCatalog,
    boardCatalogs,
    versionsByProject,
    projectDetailsByProject,
    issuesByProject,
    versionPagesByProject,
    issuePagesByProject,
    allIssues,
    approvedCommentBindingPreconditions,
    absentSourceRelationPlan,
    targetIdsByJiraKey,
    changelogByIssue,
    changelogPagesByIssue,
    accountMapping,
  } = discovery;
  const {
    archiveReferences,
    changelogArchiveReferences,
    archiveSummaries,
    archivesByProject,
  } = archive;
  const { approvedPayload, approvedReport, approvedPlanArtifact } = approval;
  const issueSprints = config.jira.projectKeys.flatMap((key) =>
    (issuesByProject.get(key) ?? []).flatMap((issue) =>
      normalizeIssueSprintReferences(issue.raw, fieldCatalog.fields),
    ),
  );
  const planningActions = mergePlanningActions([
    ...config.jira.projectKeys.flatMap(
      (key) =>
        buildJiraPlanningMigrationPlan({
          jiraCloudId: config.jira.cloudId,
          projectKey: key,
          versions: versionsByProject.get(key) ?? [],
          issueSprints: [],
          configuredBoards: [],
          existingReleases: targetPreflight.planning.releases,
          existingSprints: targetPreflight.planning.sprints,
          ledgerBindings: getJiraPlanningLedgerBindings(ledger),
        }).actions,
    ),
    ...buildJiraPlanningMigrationPlan({
      jiraCloudId: config.jira.cloudId,
      projectKey: config.jira.projectKeys[0] as string,
      versions: [],
      issueSprints,
      configuredBoards: boardCatalogs.map(({ boardId, catalog }) => ({
        boardId,
        sprints: catalog.items,
      })),
      existingReleases: targetPreflight.planning.releases,
      existingSprints: targetPreflight.planning.sprints,
      ledgerBindings: getJiraPlanningLedgerBindings(ledger),
    }).actions,
  ]);
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
  const dryIssuePlansByKey = new Map(
    dryIssuePlans.map((plan) => [plan.source.issueKey, plan]),
  );
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
    const dryIssuePlan = dryIssuePlansByKey.get(issue.key);
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
      plannedDescription:
        dryIssuePlan &&
        actionForIssuePlan(dryIssuePlan, ledger) === "create" &&
        dryIssuePlan.desired.issue
          ? dryIssuePlan.desired.content
          : undefined,
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
  const finalRelatedReports = relatedPlanningReports;
  const sealedRelatedPlan = relatedPlanForApproval(
    approvedPayload,
    relatedPlanningReports,
  );
  const approvedRelatedOperationsByIssue =
    relatedOperationsByIssue(sealedRelatedPlan);
  if (approvedPayload) {
    for (const current of relatedPlanningReports) {
      const approved = approvedRelatedOperationsByIssue.get(current.issue_key);
      if (!approved) {
        throw new JiraRunnerError("plan_fingerprint_mismatch");
      }
      assertRelatedOperationSubset(approved, current.report.operations);
    }
  }
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
    related_plan: sealedRelatedPlan,
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
  await writeJiraAccountMappingArtifact(accountMappingPath, accountMapping);
  ledger = openJiraMigrationRun(ledger, {
    runId: config.artifacts.runId,
    projectKeys: config.jira.projectKeys,
    planFingerprint: planSha256,
    at: runAt,
  });

  return {
    ledger,
    planningActions,
    existingPlanningResolutions,
    approvedPlanningResolutions,
    buildIssuePlans,
    dryIssuePlans,
    targetIssuePreconditions,
    issueBindings,
    changelogPlans,
    relatedPlanningReports,
    approvedRelatedOperationsByIssue,
    postRelatedContentByReefId,
    finalRelatedReports,
    planPayload,
    planSha256,
  };
}
