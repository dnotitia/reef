import { fingerprintJiraState } from "../execution/diff.js";
import type {
  JiraMigrationEntityResult,
  JiraMigrationPhase,
} from "../ledger.js";
import {
  indexJiraMigrationBindings,
  jiraIssueSourceIdentity,
} from "../ledger.js";
import type { JiraPlanningTargetResolution } from "../planning/entities.js";
import {
  issueOwnerMatches,
  issueReadbackRepresentation,
  mappedFingerprintForPlanning,
  sourceFingerprintForPlanning,
} from "./approval.js";
import {
  actionForChangelogPlan,
  actionForIssuePlan,
  actionForPlanning,
  actionForRelatedReport,
  mappedFingerprintForIssue,
  reconciliationAction,
  resultFor,
} from "./decisions.js";
import type { JiraExecutionInput } from "./executionContext.js";
import type { JiraRunnerReport } from "./report.js";

type PlanContext = JiraExecutionInput["plan"];
type DiscoveryContext = JiraExecutionInput["discovery"];
type RecordResult = (
  phase: JiraMigrationPhase,
  result: JiraMigrationEntityResult,
) => void;
type RecordReportOnly = (
  phase: JiraRunnerReport["terminal_classifications"][number]["phase"],
  sourceKey: string,
  action: JiraRunnerReport["terminal_classifications"][number]["action"],
  retryable?: boolean,
) => void;

export async function executeJiraDryRun(input: {
  config: JiraExecutionInput["config"];
  target: JiraExecutionInput["target"];
  runAt: string;
  plan: PlanContext;
  discovery: DiscoveryContext;
  assertNotAborted: () => void;
  getLedger: () => JiraExecutionInput["ledger"];
  record: RecordResult;
  recordReportOnly: RecordReportOnly;
  finalizePhase: (phase: JiraMigrationPhase) => void;
  persistLedger: JiraExecutionInput["persistLedger"];
}): Promise<void> {
  const {
    target,
    runAt,
    plan,
    discovery,
    assertNotAborted,
    getLedger,
    record,
    recordReportOnly,
    finalizePhase,
    persistLedger,
  } = input;
  const {
    planningActions,
    approvedPlanningResolutions,
    dryIssuePlans,
    nativeIssuePlans,
    relatedPlanningReports,
    postRelatedContentByReefId,
    finalRelatedReports,
    changelogPlans,
  } = plan;
  const { allIssues, absentSourceRelationPlan } = discovery;
  const bindingIndex = indexJiraMigrationBindings(getLedger());
  const issuesById = new Map(allIssues.map((issue) => [issue.id, issue]));
  const finalRelatedReportsByIssueKey = new Map(
    finalRelatedReports.map((report) => [report.issue_key, report]),
  );
  const nativeIssuePlansByKey = new Map(
    nativeIssuePlans.map((issuePlan) => [issuePlan.source.issueKey, issuePlan]),
  );

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
  finalizePhase("planning");
  for (const issuePlan of dryIssuePlans) {
    assertNotAborted();
    const identity = jiraIssueSourceIdentity(
      issuePlan.source.jiraCloudId,
      issuePlan.source.projectId ?? issuePlan.source.projectKey,
      issuePlan.source.issueId,
    );
    const nativeIssuePlan = nativeIssuePlansByKey.get(
      issuePlan.source.issueKey,
    );
    const currentIssuePlan = nativeIssuePlan ?? issuePlan;
    let action = actionForIssuePlan(
      currentIssuePlan,
      getLedger(),
      bindingIndex,
    );
    let readbackSucceeded = false;
    if (issuePlan.desired.issue && (action === "skip" || action === "update")) {
      const readback = await target
        .readIssue(issuePlan.desired.issue.id)
        .catch(() => null);
      readbackSucceeded = readback !== null;
      const representation = issueReadbackRepresentation(
        currentIssuePlan,
        issuePlan,
        readback,
        postRelatedContentByReefId.get(issuePlan.desired.issue.id),
      );
      if (representation === "current") {
        action = "skip";
      } else if (representation === "approved") {
        action = "update";
      } else if (
        action === "skip" ||
        !issueOwnerMatches(currentIssuePlan, readback)
      ) {
        action = "conflict";
      }
    }
    record(
      "issues",
      resultFor({
        sourceKey: identity.key,
        entityKind: "issue",
        sourceFingerprint: fingerprintJiraState(
          issuesById.get(issuePlan.source.issueId)?.raw,
        ),
        mappedFingerprint: mappedFingerprintForIssue(currentIssuePlan),
        action,
        at: runAt,
        readback: readbackSucceeded,
      }),
    );
  }
  finalizePhase("issues");
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
  for (const changelogPlan of changelogPlans) {
    recordReportOnly(
      "changelog",
      changelogPlan.sourceIdentity.key,
      actionForChangelogPlan(changelogPlan, getLedger(), bindingIndex),
    );
  }
  finalizePhase("related");
  for (const [index, deferred] of dryIssuePlans
    .flatMap((issuePlan) =>
      issuePlan.deferred.map((item) => ({ plan: issuePlan, item })),
    )
    .entries()) {
    const relatedReport = finalRelatedReportsByIssueKey.get(
      deferred.plan.source.issueKey,
    )?.report;
    recordReportOnly(
      "reconciliation",
      `reconciliation:${deferred.plan.source.issueKey}:${index}`,
      reconciliationAction(
        deferred.item,
        relatedReport,
        approvedPlanningResolutions as readonly JiraPlanningTargetResolution[],
      ),
    );
  }
  finalizePhase("reconciliation");
  await persistLedger(getLedger());
}
