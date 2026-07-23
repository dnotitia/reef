import { loadJiraAccountMappingArtifact } from "../accounts/artifactFile.js";
import {
  buildJiraAccountMigrationReport,
  collectJiraUserObservations,
  upsertJiraAccountMappingArtifact,
} from "../accounts/mapping.js";
import type { JiraMigratorConfig } from "../cli/config.js";
import type { JiraReadClient } from "../jira/client.js";
import { buildJiraFieldCatalog } from "../jira/fieldCatalog.js";
import {
  JiraMigrationBindingSchema,
  type JiraMigrationLedgerV1,
} from "../ledger.js";
import type { NormalizedJiraIssue } from "../payloads.js";
import { inferRelationSourceProjectKey, projectId } from "./decisions.js";
import { JiraRunnerError } from "./errors.js";
import { retryOperation } from "./retry.js";
import {
  assertUniqueJiraIssues,
  readAllChangelog,
  readAllProjectIssues,
  readBoardSprints,
} from "./source.js";
import type { AkbJiraMigrationTarget } from "./targetAdapter.js";

export async function discoverJiraMigrationSource(input: {
  config: JiraMigratorConfig;
  clients: ReadonlyMap<string, JiraReadClient>;
  retry: Parameters<typeof retryOperation>[1];
  runAt: string;
  ledger: JiraMigrationLedgerV1;
  target: AkbJiraMigrationTarget;
  approvedPayload: Record<string, unknown> | null;
  accountMappingPath: string;
}) {
  const {
    config,
    clients,
    retry,
    runAt,
    ledger,
    target,
    approvedPayload,
    accountMappingPath,
  } = input;
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
    path: accountMappingPath,
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

  return {
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
    approvedCommentBindings,
    absentSourceRelationPlan,
    targetIdsByJiraKey,
    changelogByIssue,
    changelogPagesByIssue,
    commentsByIssue,
    accountMapping,
    accountReport,
  };
}
