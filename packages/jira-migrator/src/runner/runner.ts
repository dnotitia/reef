import { createHash } from "node:crypto";
import { realpath, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import {
  type JiraMigratorConfig,
  secretValuesForConfig,
} from "../cli/config.js";
import { fingerprintJiraState } from "../execution/diff.js";
import {
  loadJiraMigrationLedger,
  writeJiraMigrationLedger,
} from "../execution/ledgerFile.js";
import { JiraReadClient } from "../jira/client.js";
import type { JiraMigrationLedgerV1 } from "../ledger.js";
import { approvalRelevantReport, safePlanningAction } from "./approval.js";
import { loadJiraApprovalArtifacts } from "./approvalArtifacts.js";
import {
  ensurePrivateDirectory,
  fileExists,
  jiraEndpointFingerprint,
  privateSpoolSegment,
  requireArtifactPaths,
  targetEndpointFingerprint,
} from "./artifacts.js";
import { JiraRunnerError } from "./errors.js";
import { executeJiraMigrationPlan } from "./execution.js";
import {
  type LoadedJiraMappingPolicy,
  loadJiraMappingPolicy,
} from "./mappingPolicy.js";
import { buildJiraMigrationPlan } from "./plan.js";
import {
  acquireMigrationRunLock,
  writePrivatePlanArtifact,
} from "./privateArtifact.js";
import {
  type JiraRunnerReport,
  buildJiraRunnerReport,
  loadJiraRunnerReport,
  writeJiraRunnerReport,
} from "./report.js";
import { archiveJiraMigrationSource } from "./sourceArchive.js";
import { discoverJiraMigrationSource } from "./sourceDiscovery.js";
import {
  type RelatedSourceSnapshot,
  snapshotJiraClient,
} from "./sourceSnapshot.js";
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

export { JiraRunnerError } from "./errors.js";
export {
  baseIssueReadbackMatches,
  canRecoverApprovedPlanningCreate,
  issueReadbackApprovalFingerprint,
} from "./approval.js";
export {
  actionForRelatedReport,
  inferRelationSourceProjectKey,
} from "./decisions.js";

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

  const approval = await loadJiraApprovalArtifacts({
    config,
    paths,
    sourceEndpointFingerprint,
    targetEndpointFingerprint: endpointFingerprint,
  });
  const {
    approvedReport,
    approvedPlanArtifact,
    approvedPayload,
    approvedRelatedSnapshots,
  } = approval;
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
  const discovery = await discoverJiraMigrationSource({
    config,
    clients,
    retry,
    runAt,
    ledger,
    target,
    approvedPayload,
    accountMappingPath: paths.accountMappingPath,
  });
  const { absentSourceRelationPlan, accountReport } = discovery;
  const archive = await archiveJiraMigrationSource({
    config,
    archiveRoot: paths.archiveRoot,
    runAt,
    targetActor: targetPreflight.actor,
    discovery,
  });
  const { archiveSummaries } = archive;
  const plan = await buildJiraMigrationPlan({
    config,
    accountMappingPath: paths.accountMappingPath,
    endpointFingerprint,
    runAt,
    ledger,
    target,
    targetPreflight,
    clients,
    policies,
    relatedSourceSnapshots,
    discovery,
    archive,
    approval,
  });
  ledger = plan.ledger;
  const {
    planningActions,
    dryIssuePlans,
    changelogPlans,
    relatedPlanningReports,
    planPayload,
    planSha256,
  } = plan;
  const execution = await executeJiraMigrationPlan({
    config,
    target,
    runAt,
    now,
    ledger,
    clients,
    policies,
    approval,
    discovery,
    archive,
    plan,
    assertNotAborted,
    persistLedger,
    failAfterConfirmedEntities: dependencies.failAfterConfirmedEntities,
    signal: dependencies.signal,
  });
  ledger = execution.ledger;
  const {
    terminalClassifications,
    changelogFailureReasons,
    finalRelatedReports,
  } = execution;

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
