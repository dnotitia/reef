import type { JiraMigratorConfig } from "../cli/config.js";
import {
  finalizeJiraMigrationPhase,
  recordJiraMigrationResult,
} from "../execution/checkpoint.js";
import { fingerprintJiraState } from "../execution/diff.js";
import type { JiraChangelogPlan } from "../issues/changelog.js";
import type { JiraIssueImportPlan } from "../issues/importPlan.js";
import type { JiraReadClient } from "../jira/client.js";
import {
  type JiraMigrationAction,
  type JiraMigrationEntityResult,
  type JiraMigrationLedgerV1,
  type JiraMigrationPhase,
  confirmJiraMigrationBinding,
  jiraIssueSourceIdentity,
  removeJiraMigrationBindings,
} from "../ledger.js";
import type { NormalizedJiraIssue } from "../payloads.js";
import type { JiraPlanningTargetResolution } from "../planning/entities.js";
import {
  type JiraRelatedImportReport,
  importJiraRelatedData,
} from "../related/import.js";
import {
  baseIssueReadbackMatches,
  issueOwnerMatches,
  issueReadbackApprovalFingerprint,
  mappedFingerprintForPlanning,
  semanticIssuePlan,
  sourceFingerprintForPlanning,
} from "./approval.js";
import type { JiraApprovalArtifacts } from "./approvalArtifacts.js";
import {
  actionForIssuePlan,
  actionForPlanning,
  actionForRelatedReport,
  legacyMappedFingerprintForChangelog,
  mappedFingerprintForChangelog,
  projectId,
  reconciliationAction,
  resultFor,
  safeMigrationFailureReason,
} from "./decisions.js";
import { JiraRunnerError } from "./errors.js";
import type { LoadedJiraMappingPolicy } from "./mappingPolicy.js";
import type { buildJiraMigrationPlan } from "./plan.js";
import type { JiraRunnerReport } from "./report.js";
import type { archiveJiraMigrationSource } from "./sourceArchive.js";
import type { discoverJiraMigrationSource } from "./sourceDiscovery.js";
import {
  type AkbJiraMigrationTarget,
  JiraTargetConflictError,
} from "./targetAdapter.js";

export async function executeJiraMigrationPlan(input: {
  config: JiraMigratorConfig;
  target: AkbJiraMigrationTarget;
  runAt: string;
  now: () => string;
  ledger: JiraMigrationLedgerV1;
  clients: ReadonlyMap<string, JiraReadClient>;
  policies: ReadonlyMap<string, LoadedJiraMappingPolicy>;
  approval: JiraApprovalArtifacts;
  discovery: Awaited<ReturnType<typeof discoverJiraMigrationSource>>;
  archive: Awaited<ReturnType<typeof archiveJiraMigrationSource>>;
  plan: Awaited<ReturnType<typeof buildJiraMigrationPlan>>;
  assertNotAborted: () => void;
  persistLedger: (ledger: JiraMigrationLedgerV1) => Promise<void>;
  failAfterConfirmedEntities?: number;
  signal?: AbortSignal;
}) {
  const {
    config,
    target,
    runAt,
    now,
    clients,
    policies,
    approval,
    discovery,
    archive,
    plan,
    assertNotAborted,
    persistLedger,
    failAfterConfirmedEntities,
    signal,
  } = input;
  let ledger = input.ledger;
  const { approvedCommentBindingPreconditions, approvedCommentBindings } =
    discovery;
  const {
    allIssues,
    targetIdsByJiraKey,
    absentSourceRelationPlan,
    accountMapping,
  } = discovery;
  const { archiveReferences } = archive;
  const {
    planningActions,
    existingPlanningResolutions,
    approvedPlanningResolutions,
    buildIssuePlans,
    dryIssuePlans,
    targetIssuePreconditions,
    issueBindings,
    changelogPlans,
    relatedPlanningReports,
    postRelatedContentByReefId,
  } = plan;
  let { finalRelatedReports } = plan;
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
        failAfterConfirmedEntities !== undefined &&
        confirmed >= failAfterConfirmedEntities
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
          if (changelogError instanceof JiraRunnerError || signal?.aborted) {
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
            if (changelogError instanceof JiraRunnerError || signal?.aborted) {
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
  return {
    ledger,
    terminalClassifications,
    changelogFailureReasons,
    finalRelatedReports,
  };
}
