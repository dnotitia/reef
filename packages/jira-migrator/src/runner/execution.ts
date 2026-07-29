import {
  finalizeJiraMigrationPhase,
  recordJiraMigrationResult,
} from "../execution/checkpoint.js";
import { fingerprintJiraState } from "../execution/diff.js";
import type { JiraIssueImportPlan } from "../issues/importPlan.js";
import {
  type JiraMigrationAction,
  type JiraMigrationEntityResult,
  type JiraMigrationPhase,
  confirmJiraMigrationBinding,
  jiraIssueSourceIdentity,
} from "../ledger.js";
import type { NormalizedJiraIssue } from "../payloads.js";
import type { JiraPlanningTargetResolution } from "../planning/entities.js";
import {
  type JiraRelatedImportReport,
  importJiraRelatedData,
} from "../related/import.js";
import { isRetryableAkbReadError } from "./akbReadRetry.js";
import {
  baseIssueReadbackMatches,
  completedIssueReadbackMatches,
  issueReadbackApprovalFingerprint,
  issueReadbackRepresentation,
  mappedFingerprintForPlanning,
  semanticIssuePlan,
  sourceFingerprintForPlanning,
} from "./approval.js";
import {
  actionForChangelogPlan,
  actionForIssuePlan,
  actionForRelatedReport,
  legacyMappedFingerprintForChangelog,
  mappedFingerprintForChangelog,
  mappedFingerprintForIssue,
  projectId,
  reconciliationAction,
  relatedExecutionError,
  resultFor,
  runScopedMappedFingerprintForChangelog,
  safeMigrationFailureReason,
} from "./decisions.js";
import { executeJiraDryRun } from "./dryRunExecution.js";
import { JiraRunnerError } from "./errors.js";
import type { JiraExecutionInput } from "./executionContext.js";
import {
  issueReferences,
  scheduleIssuePlansForApply,
} from "./issueSchedule.js";
import type { JiraRunnerReport } from "./report.js";
import {
  type AkbJiraMigrationTarget,
  JiraTargetConflictError,
} from "./targetAdapter.js";

export async function executeJiraMigrationPlan(input: JiraExecutionInput) {
  const {
    config,
    target,
    runAt,
    now,
    clients,
    policies,
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
    approvedPlanningResolutions,
    buildIssuePlans,
    dryIssuePlans,
    targetIssuePreconditions,
    issueBindings,
    changelogPlans,
    relatedPlanningReports,
    approvedRelatedOperationsByIssue,
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
  const finalizePhase = (phase: JiraMigrationPhase): void => {
    ledger = finalizeJiraMigrationPhase(ledger, {
      runId: config.artifacts.runId,
      phase,
      at: runAt,
    });
  };

  if (config.mode === "dry-run") {
    await executeJiraDryRun({
      config,
      target,
      runAt,
      plan,
      discovery,
      assertNotAborted,
      getLedger: () => ledger,
      record,
      recordReportOnly,
      finalizePhase,
      persistLedger,
    });
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

    const issueSchedule = scheduleIssuePlansForApply(
      buildIssuePlans(planningResolutions),
    );
    const applyIssuePlans = issueSchedule.plans;
    const approvedIssuePlansByKey = new Map(
      dryIssuePlans.map((plan) => [plan.source.issueKey, plan]),
    );
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
      acceptApprovedRepresentation: boolean,
    ): Promise<{
      applied: Awaited<ReturnType<AkbJiraMigrationTarget["applyIssue"]>> | null;
      readbackFound: boolean;
    }> => {
      const desired = plan.desired.issue;
      let readback: Awaited<
        ReturnType<AkbJiraMigrationTarget["readIssue"]>
      > | null = null;
      if (desired) {
        try {
          readback = await target.readIssue(desired.id);
        } catch (error) {
          if (isRetryableAkbReadError(error))
            throw new JiraRunnerError("target_unavailable");
        }
      }
      if (
        !desired ||
        !readback ||
        !(acceptApprovedRepresentation
          ? completedIssueReadbackMatches(
              plan,
              approvedIssuePlansByKey.get(plan.source.issueKey) ?? plan,
              readback,
              postRelatedContentByReefId.get(desired.id),
            )
          : baseIssueReadbackMatches(
              plan,
              readback,
              postRelatedContentByReefId.get(desired.id),
            ))
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
    const failedIssueClaimIds = new Set(issueSchedule.blockedIssueIds);
    const conflictedIssueClaimIds = new Set<string>();
    const recoveredCreateIssues = new Map<
      string,
      Awaited<ReturnType<AkbJiraMigrationTarget["applyIssue"]>>
    >();
    const confirmedIssueSourceKeys = new Set<string>();
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
      const identity = jiraIssueSourceIdentity(
        plan.source.jiraCloudId,
        plan.source.projectId ?? plan.source.projectKey,
        plan.source.issueId,
      );
      const recovered = await recoverAppliedIssue(plan, true);
      if (recovered.applied) {
        recoveredCreateIssues.set(identity.key, recovered.applied);
        continue;
      }
      try {
        await target.claimIssue(plan);
      } catch (error) {
        if (isRetryableAkbReadError(error))
          throw new JiraRunnerError("target_unavailable");
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
      const mappedFingerprint = mappedFingerprintForIssue(plan);
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
      const recoveredCreate = recoveredCreateIssues.get(identity.key);
      if (recoveredCreate) {
        ledger = confirmJiraMigrationBinding(ledger, {
          sourceIdentity: identity,
          target: {
            target_kind: "issue",
            reef_id: recoveredCreate.reefId,
            document_uri: recoveredCreate.documentUri,
          },
          sourceFingerprint,
          mappedStateFingerprint: mappedFingerprint,
          lastAppliedAt: now(),
          writeSucceeded: true,
          readbackSucceeded: true,
          rawArchiveReference: archiveReferences.get(plan.source.issueKey)
            ?.issue,
        });
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
      let action = actionForIssuePlan(plan, ledger);
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
      let applied:
        | Awaited<ReturnType<AkbJiraMigrationTarget["applyIssue"]>>
        | undefined;
      let approvedUpdateReadback:
        | Awaited<ReturnType<AkbJiraMigrationTarget["readIssue"]>>
        | undefined;
      if (action === "skip") {
        const desired = plan.desired.issue;
        let readback: Awaited<
          ReturnType<AkbJiraMigrationTarget["readIssue"]>
        > | null = null;
        if (desired) {
          try {
            readback = await target.readIssue(desired.id);
          } catch (error) {
            if (isRetryableAkbReadError(error))
              throw new JiraRunnerError("target_unavailable");
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
        const representation = issueReadbackRepresentation(
          plan,
          approvedIssuePlansByKey.get(plan.source.issueKey) ?? plan,
          readback,
          desired ? postRelatedContentByReefId.get(desired.id) : undefined,
        );
        if (representation === "approved" && readback) {
          action = "update";
          approvedUpdateReadback = readback;
        } else if (representation !== "current") {
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
        if (action === "skip") {
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
      }
      if (action === "update" && !approvedUpdateReadback) {
        const desired = plan.desired.issue;
        let current: Awaited<
          ReturnType<AkbJiraMigrationTarget["readIssue"]>
        > | null = null;
        if (desired) {
          try {
            current = await target.readIssue(desired.id);
          } catch (error) {
            if (isRetryableAkbReadError(error))
              throw new JiraRunnerError("target_unavailable");
          }
        }
        const representation = desired
          ? issueReadbackRepresentation(
              plan,
              approvedIssuePlansByKey.get(plan.source.issueKey) ?? plan,
              current,
              postRelatedContentByReefId.get(desired.id),
            )
          : "mismatch";
        if (desired && representation === "current") {
          action = "skip";
          applied = {
            reefId: desired.id,
            documentUri: `akb://${config.target.vault}/coll/issues/doc/${desired.id.toLowerCase()}.md`,
            commitHash: current?.commit_hash ?? "",
          };
        } else if (current && representation === "approved") {
          approvedUpdateReadback = current;
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
        if (!applied) {
          if (action === "skip") {
            throw new Error("target_issue_skip_readback_missing");
          }
          applied = await target.applyIssue(
            plan,
            action,
            approvedUpdateReadback,
          );
        }
      } catch (error) {
        const recovered = await recoverAppliedIssue(plan, action === "create");
        if (!recovered.applied) {
          const conflict = error instanceof JiraTargetConflictError;
          if (action === "create" && plan.desired.issue) {
            (conflict ? conflictedIssueClaimIds : failedIssueClaimIds).add(
              plan.desired.issue.id,
            );
          }
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
    const unconfirmedIssueTargets = new Set(
      allIssues
        .filter((issue) => !confirmedIssueBinding(issue))
        .flatMap((issue) => [issue.id, issue.key]),
    );
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
      const issueArchiveReferences = archiveReferences.get(issue.key);
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
          descriptionConversionOptions: {
            accountMapping: { artifact: accountMapping },
            descriptionRawArchiveReference:
              issueArchiveReferences?.descriptionAdf,
            mediaRawArchiveReferences: issueArchiveReferences?.media,
          },
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
          preserveUnresolvedIssueTargets: unconfirmedIssueTargets,
          approvedOperations: approvedRelatedOperationsByIssue.get(issue.key),
          mode: "apply",
          now,
          async checkpointLedger(attachmentLedger) {
            ledger = attachmentLedger;
            await checkpoint();
          },
        });
      } catch (relatedError) {
        const relatedFailure = relatedExecutionError(relatedError);
        if (relatedFailure.retryable) {
          await checkpoint();
          throw new JiraRunnerError("target_unavailable");
        }
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
              phase: "write" as const,
              retryable: relatedFailure.retryable,
              reason: relatedFailure.reason,
            },
          ],
        } as JiraRelatedImportReport;
        relatedApplyReports.push({ issue_key: issue.key, report });
        recordReportOnly(
          "related",
          `related:${issue.key}`,
          relatedFailure.action,
          relatedFailure.retryable,
        );
        await checkpoint();
        continue;
      }
      ledger = result.ledger;
      relatedApplyReports.push({ issue_key: issue.key, report: result.report });
      if (result.report.failures.some((failure) => failure.retryable)) {
        await checkpoint();
        throw new JiraRunnerError("target_unavailable");
      }
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
      let action = actionForChangelogPlan(plan, ledger);
      const existingBinding = ledger.bindings.find(
        (candidate) => candidate.source_key === plan.sourceIdentity.key,
      );
      const bindingMatchesSource =
        existingBinding?.source_fingerprint === plan.sourceFingerprint;
      const bindingUsesCurrentFingerprint =
        bindingMatchesSource &&
        existingBinding.mapped_state_fingerprint ===
          mappedFingerprintForChangelog(plan);
      const bindingReference = existingBinding?.raw_archive_reference;
      const bindingUsesRunScopedFingerprint =
        bindingMatchesSource &&
        bindingReference !== null &&
        bindingReference !== undefined &&
        existingBinding.mapped_state_fingerprint ===
          runScopedMappedFingerprintForChangelog(plan, bindingReference);
      const bindingUsesLegacyFingerprint =
        bindingMatchesSource &&
        bindingReference !== null &&
        bindingReference !== undefined &&
        existingBinding.mapped_state_fingerprint ===
          legacyMappedFingerprintForChangelog(plan, bindingReference);
      if (
        action !== "conflict" &&
        (bindingUsesCurrentFingerprint ||
          bindingUsesRunScopedFingerprint ||
          bindingUsesLegacyFingerprint)
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
          if (bindingUsesRunScopedFingerprint || bindingUsesLegacyFingerprint) {
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
