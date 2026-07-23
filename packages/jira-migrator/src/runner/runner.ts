import { chmod, lstat, mkdir } from "node:fs/promises";
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
import type { JiraIssueImportPlan } from "../issues/importPlan.js";
import { buildJiraIssueImportPlan } from "../issues/mapping.js";
import { JiraReadClient } from "../jira/client.js";
import { buildJiraFieldCatalog } from "../jira/fieldCatalog.js";
import {
  type JiraMigrationAction,
  type JiraMigrationEntityResult,
  type JiraMigrationLedgerV1,
  type JiraMigrationPhase,
  confirmJiraMigrationBinding,
  getJiraPlanningLedgerBindings,
  jiraIssueSourceIdentity,
  openJiraMigrationRun,
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
import {
  type LoadedJiraMappingPolicy,
  loadJiraMappingPolicy,
} from "./mappingPolicy.js";
import {
  type JiraRunnerReport,
  buildJiraRunnerReport,
  loadJiraRunnerReport,
  writeJiraRunnerReport,
} from "./report.js";
import {
  readAllChangelog,
  readAllProjectIssues,
  readBoardSprints,
} from "./source.js";
import {
  type AkbJiraMigrationTarget,
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

export class JiraRunnerError extends Error {
  constructor(
    readonly code:
      | "artifact_paths_required"
      | "mapping_policy_required"
      | "dry_run_approval_required"
      | "dry_run_scope_mismatch"
      | "plan_fingerprint_mismatch"
      | "interrupted"
      | "failpoint",
  ) {
    super(code);
    this.name = "JiraRunnerError";
  }
}

const requireArtifactPaths = (config: JiraMigratorConfig) => {
  const { ledgerPath, archiveRoot, accountMappingPath, reportPath } =
    config.artifacts;
  if (!ledgerPath || !archiveRoot || !accountMappingPath || !reportPath) {
    throw new JiraRunnerError("artifact_paths_required");
  }
  return { ledgerPath, archiveRoot, accountMappingPath, reportPath };
};

const projectId = (issue: NormalizedJiraIssue): string =>
  String(issue.raw.fields.project?.id ?? issue.projectKey ?? "unknown");

const safePlanningAction = (action: JiraPlanningAction) => ({
  classification: action.classification,
  reason: action.reason,
  source_identity: action.sourceIdentity,
  selection: [...action.selection],
  target:
    action.target === null
      ? null
      : {
          kind: action.target.kind,
          name: action.target.item.name,
          state: action.target.item,
        },
  target_id: action.targetId,
  report: action.report,
});

const sourceFingerprintForPlanning = (action: JiraPlanningAction): string =>
  fingerprintJiraState(action.provenance.source);

const mappedFingerprintForPlanning = (action: JiraPlanningAction): string =>
  fingerprintJiraState({
    target: action.target,
    classification: action.classification,
  });

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

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
};

const ensurePrivateDirectory = async (path: string): Promise<void> => {
  try {
    const stat = await lstat(path);
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      (process.platform !== "win32" && (stat.mode & 0o777) !== 0o700)
    ) {
      throw new Error("artifact_directory_permission_violation");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "artifact_directory_permission_violation"
    ) {
      throw error;
    }
    await mkdir(path, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(path, 0o700);
  }
};

const reportMatchesConfig = (
  report: JiraRunnerReport,
  config: JiraMigratorConfig,
): boolean =>
  report.run.run_id === config.artifacts.runId &&
  report.run.source.jira_cloud_id === config.jira.cloudId &&
  JSON.stringify(report.run.source.project_keys) ===
    JSON.stringify(config.jira.projectKeys) &&
  JSON.stringify(report.run.source.board_ids) ===
    JSON.stringify(config.jira.boardIds) &&
  report.run.target.vault === config.target.vault &&
  report.approval.dry_run_plan_sha256 === config.expectedPlanSha256;

export async function runJiraMigration(
  config: JiraMigratorConfig,
  dependencies: JiraRunnerDependencies = {},
): Promise<JiraRunnerResult> {
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
  const clients = new Map(
    config.jira.projectKeys.map((key) => [key, createClient(key)]),
  );
  const policies = new Map<string, LoadedJiraMappingPolicy>();
  for (const key of config.jira.projectKeys) {
    const path = config.jira.mappingPolicyPaths[key];
    if (!path) throw new JiraRunnerError("mapping_policy_required");
    policies.set(key, await loadJiraMappingPolicy(path));
  }

  let approvedReport: JiraRunnerReport | null = null;
  if (config.mode === "apply") {
    if (!(await fileExists(paths.reportPath))) {
      throw new JiraRunnerError("dry_run_approval_required");
    }
    approvedReport = await loadJiraRunnerReport(paths.reportPath);
    if (!reportMatchesConfig(approvedReport, config)) {
      throw new JiraRunnerError("dry_run_scope_mismatch");
    }
  }

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
    approvedReport &&
    approvedReport.run.target.actor !== targetPreflight.actor
  ) {
    throw new JiraRunnerError("dry_run_scope_mismatch");
  }
  const firstClient = clients.get(config.jira.projectKeys[0] as string);
  if (!firstClient) throw new Error("jira_client_missing");
  const retry = {
    maxRetries: config.control.retryCount,
    baseDelayMs: config.control.retryBaseDelayMs,
    maxDelayMs: config.control.retryMaxDelayMs,
  };
  const fieldResult = await firstClient.listFields();
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
  const issuesByProject = new Map<string, NormalizedJiraIssue[]>();
  for (const key of config.jira.projectKeys) {
    const client = clients.get(key);
    if (!client) throw new Error("jira_client_missing");
    const [versions, issues] = await Promise.all([
      client.readProjectVersionCatalog({ projectIdOrKey: key }),
      readAllProjectIssues(client, key, retry),
    ]);
    versionsByProject.set(key, versions.items);
    issuesByProject.set(key, issues.items);
  }
  const allIssues = [...issuesByProject.values()]
    .flat()
    .sort((left, right) => left.key.localeCompare(right.key));
  const issueIds = await target.reserveIssueIds(allIssues.length);
  const targetIdsByJiraKey = Object.fromEntries(
    allIssues.map((issue, index) => [issue.key, issueIds[index] as string]),
  );
  const changelogByIssue = new Map<
    string,
    Awaited<ReturnType<typeof readAllChangelog>>["items"]
  >();
  for (const issue of allIssues) {
    const client = clients.get(
      issue.projectKey ?? issue.key.split("-")[0] ?? "",
    );
    if (!client) throw new Error("jira_client_missing");
    const changelog = await readAllChangelog(client, issue.key, retry);
    changelogByIssue.set(issue.key, changelog.items);
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
        changelog: changelogByIssue.get(issue.key) ?? [],
      }),
    ),
    observedAt: runAt,
  }).artifact;
  await writeJiraAccountMappingArtifact(
    paths.accountMappingPath,
    accountMapping,
  );
  const accountReport = buildJiraAccountMigrationReport(accountMapping);

  const archiveReferences = new Map<
    string,
    { issue: RawArchiveReference; descriptionAdf?: RawArchiveReference }
  >();
  const changelogArchiveReferences = new Map<string, RawArchiveReference>();
  const archiveSummaries = [];
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
    }
    archiveSummaries.push({ project_key: key, ...(await archive.verify()) });
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
  const dryIssuePlans = buildIssuePlans(existingPlanningResolutions);
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
      attachmentPolicy: {
        commentVisibilityCompleteness: "verified",
        maxBytes: 20 * 1024 * 1024,
      },
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
  let finalRelatedReports = relatedPlanningReports;
  const planSha256 = fingerprintJiraState({
    source: {
      jira_cloud_id: config.jira.cloudId,
      project_keys: config.jira.projectKeys,
      board_ids: config.jira.boardIds,
    },
    target: { vault: config.target.vault, actor: targetPreflight.actor },
    planning: planningActions.map(safePlanningAction),
    issues: dryIssuePlans.map((plan) => ({
      source: plan.source,
      desired: plan.desired,
      deferred: plan.deferred,
      field_results: plan.field_results,
      status: plan.status,
    })),
    related: relatedPlanningReports,
    changelog: changelogPlans.map((plan) => ({
      source_identity: plan.sourceIdentity,
      source_fingerprint: plan.sourceFingerprint,
      report: plan.report,
      items: plan.items.map((item) => ({
        item_index: item.itemIndex,
        field_id: item.fieldId,
        classification: item.classification,
        reason: item.reason,
      })),
    })),
  });
  if (config.expectedPlanSha256 && config.expectedPlanSha256 !== planSha256) {
    throw new JiraRunnerError("plan_fingerprint_mismatch");
  }
  if (approvedReport && approvedReport.plan_sha256 !== planSha256) {
    throw new JiraRunnerError("plan_fingerprint_mismatch");
  }
  ledger = openJiraMigrationRun(ledger, {
    runId: config.artifacts.runId,
    projectKeys: config.jira.projectKeys,
    planFingerprint: planSha256,
    at: runAt,
  });

  const terminalClassifications: JiraRunnerReport["terminal_classifications"] =
    [];
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
    });
  };
  const recordReportOnly = (
    phase: JiraRunnerReport["terminal_classifications"][number]["phase"],
    sourceKey: string,
    action: JiraMigrationAction,
  ): void => {
    terminalClassifications.push({
      phase,
      source_key: sourceKey,
      action,
    });
  };
  const changelogAction = (
    plan: JiraChangelogPlan,
  ): "create" | "skip" | "conflict" => {
    if (plan.report.totals.failed > 0) return "conflict";
    const binding = ledger.bindings.find(
      (candidate) => candidate.source_key === plan.sourceIdentity.key,
    );
    return binding?.source_fingerprint === plan.sourceFingerprint
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
      record(
        "issues",
        resultFor({
          sourceKey: identity.key,
          entityKind: "issue",
          sourceFingerprint: fingerprintJiraState(
            allIssues.find((issue) => issue.id === plan.source.issueId)?.raw,
          ),
          mappedFingerprint: fingerprintJiraState(plan.desired),
          action: actionForIssuePlan(plan, ledger),
          at: runAt,
          readback: true,
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
        related.report.failures.length > 0 ? "failed" : "skip",
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
      recordReportOnly(
        "reconciliation",
        `reconciliation:${deferred.plan.source.issueKey}:${index}`,
        "skip",
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
    const planningResolutions = [...existingPlanningResolutions];
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
      const resolution = await target.applyPlanning(action);
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
      if (action === "skip") {
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
      const applied = await target.applyIssue(plan, action);
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
    const relatedApplyReports: typeof relatedPlanningReports = [];
    for (const issue of allIssues) {
      assertNotAborted();
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
        attachmentPolicy: {
          commentVisibilityCompleteness: "verified",
          maxBytes: 20 * 1024 * 1024,
        },
        resolveIssueTarget(sourceIdOrKey) {
          const reefId = issueBindings[sourceIdOrKey];
          return reefId
            ? {
                reefId,
                documentUri: `akb://${config.target.vault}/coll/issues/doc/${reefId.toLowerCase()}.md`,
              }
            : null;
        },
        mode: "apply",
        now,
      });
      ledger = result.ledger;
      relatedApplyReports.push({ issue_key: issue.key, report: result.report });
      recordReportOnly(
        "related",
        `related:${issue.key}`,
        result.report.failures.length > 0
          ? "failed"
          : result.report.comments.created +
                result.report.comments.updated +
                result.report.attachments.created +
                result.report.links.applied +
                result.report.remote_links.applied >
              0
            ? "create"
            : "skip",
      );
      await checkpoint();
    }
    finalRelatedReports = relatedApplyReports;
    for (const plan of changelogPlans) {
      assertNotAborted();
      const action = changelogAction(plan);
      if (action === "create") {
        const activities = plan.items.flatMap((item) =>
          item.activity ? [item.activity] : [],
        );
        if (activities.length > 0) await target.appendActivity(activities);
        for (const item of plan.items) {
          if (!item.externalRef) continue;
          await target.relatedTarget().putExternalRef({
            idempotencyKey: `${plan.sourceIdentity.key}:${item.itemIndex}`,
            reefId: issueBindings[plan.sourceIdentity.issue_id] as string,
            ref: item.externalRef,
            provenance: {
              jira_cloud_id: config.jira.cloudId,
              issue_id: plan.sourceIdentity.issue_id,
              history_id: plan.sourceIdentity.history_id,
              item_index: item.itemIndex,
            },
          });
        }
        ledger = confirmJiraMigrationBinding(ledger, {
          sourceIdentity: plan.sourceIdentity,
          target: {
            target_kind: "changelog_history",
            idempotency_key: plan.sourceIdentity.key,
          },
          sourceFingerprint: plan.sourceFingerprint,
          mappedStateFingerprint: fingerprintJiraState(plan.report),
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
      recordReportOnly(
        "reconciliation",
        `reconciliation:${deferred.plan.source.issueKey}:${index}`,
        "skip",
      );
    }
    ledger = finalizeJiraMigrationPhase(ledger, {
      runId: config.artifacts.runId,
      phase: "reconciliation",
      at: now(),
    });
    await persistLedger(ledger);
  }

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
      })),
      reconciliation: dryIssuePlans.flatMap((plan) => plan.deferred),
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
  const expectedReport = (await fileExists(paths.reportPath))
    ? await loadJiraRunnerReport(paths.reportPath)
    : undefined;
  await writeJiraRunnerReport({
    path: paths.reportPath,
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
