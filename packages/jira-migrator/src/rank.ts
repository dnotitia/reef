import {
  type IssueMetadata,
  JIRA_RANK_MAPPED,
  type JiraRankMappingResult,
  type JiraRankUnmappedReason,
  mapJiraRanksToIssueOrder,
} from "@reef/core";

export interface JiraRankInput {
  reefId: string;
  jiraKey: string;
  jiraRank?: string | null;
}

export type JiraRankReportClassification =
  JiraRankMappingResult["classification"];

export interface JiraRankImportPlan {
  reefId: string;
  jiraKey: string;
  rank: number | null;
  reportClassification: JiraRankReportClassification;
  reportReason?: JiraRankUnmappedReason;
  provenance: {
    source: "jira";
    field: "Rank";
    value: string | null;
  };
  issueFields: {
    rank?: number;
    custom_fields: Record<string, unknown>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jiraCustomFieldsForPlan(
  plan: Pick<
    JiraRankImportPlan,
    "jiraKey" | "rank" | "reportClassification" | "reportReason" | "provenance"
  >,
  existing?: IssueMetadata["custom_fields"],
): Record<string, unknown> {
  const base = isRecord(existing) ? { ...existing } : {};
  const existingJira = isRecord(base.jira) ? base.jira : {};
  return {
    ...base,
    jira: {
      ...existingJira,
      key: plan.jiraKey,
      rank: plan.provenance.value,
      rank_mapping: {
        classification: plan.reportClassification,
        ...(plan.reportReason !== undefined && { reason: plan.reportReason }),
        ...(plan.rank !== null && { rank: plan.rank }),
      },
    },
  };
}

function planFromMapping(
  input: JiraRankInput,
  mapping: JiraRankMappingResult,
): JiraRankImportPlan {
  const basePlan = {
    reefId: input.reefId,
    jiraKey: input.jiraKey,
    rank: mapping.rank,
    reportClassification: mapping.classification,
    ...(mapping.reason !== undefined && { reportReason: mapping.reason }),
    provenance: {
      source: "jira" as const,
      field: "Rank" as const,
      value: mapping.jiraRank,
    },
  };
  return {
    ...basePlan,
    issueFields: {
      ...(mapping.classification === JIRA_RANK_MAPPED &&
        mapping.rank !== null && { rank: mapping.rank }),
      custom_fields: jiraCustomFieldsForPlan(basePlan),
    },
  };
}

export function buildJiraRankImportPlan(
  inputs: readonly JiraRankInput[],
): JiraRankImportPlan[] {
  const mappings = mapJiraRanksToIssueOrder(
    inputs.map((input) => ({
      id: input.reefId,
      jiraRank: input.jiraRank,
    })),
  );
  return inputs.map((input, index) => planFromMapping(input, mappings[index]));
}

export function applyJiraRankImportPlan(
  issue: IssueMetadata,
  plan: JiraRankImportPlan,
): IssueMetadata {
  if (issue.id !== plan.reefId) {
    throw new Error(
      `Rank import plan for ${plan.reefId} cannot be applied to ${issue.id}`,
    );
  }
  return {
    ...issue,
    ...(plan.issueFields.rank !== undefined && { rank: plan.issueFields.rank }),
    custom_fields: jiraCustomFieldsForPlan(plan, issue.custom_fields),
  };
}
