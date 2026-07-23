import type { JiraMigratorConfig } from "../cli/config.js";
import { fingerprintJiraState } from "../execution/diff.js";
import { type JiraRunnerArtifactPaths, fileExists } from "./artifacts.js";
import { JiraRunnerError } from "./errors.js";
import {
  type PrivatePlanArtifact,
  readPrivatePlanArtifact,
} from "./privateArtifact.js";
import { type JiraRunnerReport, loadJiraRunnerReport } from "./report.js";

export interface JiraApprovalArtifacts {
  approvedReport: JiraRunnerReport | null;
  approvedPlanArtifact: PrivatePlanArtifact | null;
  approvedPayload: Record<string, unknown> | null;
  approvedRelatedSnapshots: Record<string, unknown> | null;
}

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

const approvalPayload = (
  artifact: PrivatePlanArtifact | null,
): Record<string, unknown> | null =>
  artifact?.payload &&
  typeof artifact.payload === "object" &&
  !Array.isArray(artifact.payload)
    ? (artifact.payload as Record<string, unknown>)
    : null;

const relatedSnapshots = (
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null => {
  const source = payload?.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }
  const related = (source as Record<string, unknown>).related;
  return related && typeof related === "object" && !Array.isArray(related)
    ? (related as Record<string, unknown>)
    : null;
};

export async function loadJiraApprovalArtifacts(input: {
  config: JiraMigratorConfig;
  paths: JiraRunnerArtifactPaths;
  sourceEndpointFingerprint: string;
  targetEndpointFingerprint: string;
}): Promise<JiraApprovalArtifacts> {
  const { config, paths } = input;
  let approvedReport: JiraRunnerReport | null = null;
  let approvedPlanArtifact: PrivatePlanArtifact | null = null;
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
        input.sourceEndpointFingerprint ||
      approvedPlanArtifact.target.vault !== config.target.vault ||
      approvedPlanArtifact.target.endpoint_fingerprint !==
        input.targetEndpointFingerprint ||
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
        input.sourceEndpointFingerprint ||
      approvedPlanArtifact.target.vault !== config.target.vault ||
      approvedPlanArtifact.target.endpoint_fingerprint !==
        input.targetEndpointFingerprint
    ) {
      throw new JiraRunnerError("dry_run_scope_mismatch");
    }
  }
  const approvedPayload = approvalPayload(approvedPlanArtifact);
  return {
    approvedReport,
    approvedPlanArtifact,
    approvedPayload,
    approvedRelatedSnapshots: relatedSnapshots(approvedPayload),
  };
}
