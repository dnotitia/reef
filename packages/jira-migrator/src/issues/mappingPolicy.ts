import type { IssueType, Priority } from "@reef/core";
import type { normalizeJiraIssue } from "../payloads.js";
import type {
  JiraIssueTypeMappingRule,
  JiraPriorityMappingRule,
  JiraStatusMappingRule,
} from "./mappingContracts.js";

const normalizeName = (value: string): string =>
  value.trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");

const matchesIdOrName = (
  source: { id: string | null; name: string | null },
  rule: { id?: string; name?: string },
): boolean =>
  (rule.id !== undefined && source.id === rule.id) ||
  (rule.name !== undefined &&
    source.name !== null &&
    normalizeName(source.name) === normalizeName(rule.name));

export const resolveStatus = (
  issue: ReturnType<typeof normalizeJiraIssue>,
  rules: readonly JiraStatusMappingRule[],
): JiraStatusMappingRule | null => {
  const source = { id: issue.statusId, name: issue.status };
  const exact = rules.find((rule) => matchesIdOrName(source, rule));
  if (exact) return exact;
  return (
    rules.find(
      (rule) =>
        rule.id === undefined &&
        rule.name === undefined &&
        rule.categoryKey !== undefined &&
        issue.statusCategoryKey !== null &&
        normalizeName(rule.categoryKey) ===
          normalizeName(issue.statusCategoryKey),
    ) ?? null
  );
};

export const resolveIssueType = (
  issue: ReturnType<typeof normalizeJiraIssue>,
  rules: readonly JiraIssueTypeMappingRule[],
): IssueType | null => {
  if (issue.issueTypeSubtask) return "task";
  return (
    rules.find((rule) =>
      matchesIdOrName({ id: issue.issueTypeId, name: issue.issueType }, rule),
    )?.issueType ?? null
  );
};

export const resolvePriority = (
  issue: ReturnType<typeof normalizeJiraIssue>,
  rules: readonly JiraPriorityMappingRule[],
): Priority | null => {
  if (!issue.priority) return null;
  return (
    rules.find((rule) =>
      matchesIdOrName(
        issue.priority as { id: string | null; name: string | null },
        rule,
      ),
    )?.priority ?? null
  );
};
