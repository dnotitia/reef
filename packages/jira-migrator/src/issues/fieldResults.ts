import type {
  JiraCanonicalFieldRole,
  JiraFieldResolution,
} from "../jira/fieldCatalog.js";
import type { JiraIssueFieldResult } from "./importPlan.js";

export const safeUrl = (value: string | undefined): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
};

export const asString = (value: unknown): string | null =>
  typeof value === "string" || typeof value === "number" ? String(value) : null;

export const fieldResult = (
  sourceFieldId: string,
  sourceFieldName: string,
  targetField: string | null,
  classification: JiraIssueFieldResult["classification"],
  reason: string,
  preservationLocation: string | null = null,
): JiraIssueFieldResult => ({
  sourceFieldId,
  sourceFieldName,
  targetField,
  classification,
  reason,
  preservationLocation,
});

export const catalogFieldResult = (
  role: JiraCanonicalFieldRole,
  resolution: JiraFieldResolution,
): JiraIssueFieldResult => {
  const classification =
    resolution.classification === "resolved"
      ? "mapped"
      : resolution.classification === "field_unresolved"
        ? "unsupported"
        : "blocked";
  return fieldResult(
    resolution.field?.id ?? `catalog:${role}`,
    resolution.field?.name ?? role,
    role,
    classification,
    `${resolution.classification}:${resolution.reason}`,
    resolution.classification === "resolved"
      ? `desired.issue/custom_fields.jira.fields.${role}`
      : "raw_preservation.archiveReferences",
  );
};

export const knownFieldKeys = new Set([
  "summary",
  "description",
  "created",
  "updated",
  "labels",
  "project",
  "issuetype",
  "status",
  "assignee",
  "reporter",
  "creator",
  "priority",
  "duedate",
  "resolution",
  "resolutiondate",
  "parent",
  "fixVersions",
  "versions",
  "components",
  "environment",
  "watches",
  "votes",
  "timetracking",
  "worklog",
  "attachment",
  "issuelinks",
]);
