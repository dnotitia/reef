import type { IssueLayout, IssueScope } from "./viewMode";

export const ISSUE_GROUP_BY_VALUES = [
  "none",
  "status",
  "assignee",
  "priority",
  "sprint",
  "label",
] as const;

export type IssueGroupBy = (typeof ISSUE_GROUP_BY_VALUES)[number];
export type IssueWorkspaceView = IssueLayout;

const ISSUE_GROUP_BY_SET = new Set<string>(ISSUE_GROUP_BY_VALUES);

export function defaultIssueGroupBy(
  scope: IssueScope,
  view: IssueWorkspaceView,
): IssueGroupBy {
  if (scope === "backlog") return "priority";
  return view === "board" ? "status" : "none";
}

export function parseIssueGroupBy(
  value: string | null | undefined,
  scope: IssueScope,
  view: IssueWorkspaceView,
): IssueGroupBy {
  const defaultValue = defaultIssueGroupBy(scope, view);
  if (view !== "board" && view !== "list") return "none";
  if (scope === "backlog" && value !== "none" && value !== "priority") {
    return defaultValue;
  }
  if (!value || !ISSUE_GROUP_BY_SET.has(value)) {
    return defaultValue;
  }
  if (scope !== "backlog" && view === "board" && value === "none") {
    return defaultValue;
  }
  return value as IssueGroupBy;
}

export function normalizeIssueGroupByParam(
  value: string | null | undefined,
  scope: IssueScope,
  view: IssueWorkspaceView,
): string {
  return parseIssueGroupBy(value, scope, view);
}

export function serializeIssueGroupBy(value: IssueGroupBy): string {
  return value;
}

export function issueGroupByOptions(
  scope: IssueScope,
  view: IssueWorkspaceView,
): readonly IssueGroupBy[] {
  if (view !== "board" && view !== "list") return [];
  if (scope === "backlog") return ["none", "priority"] as const;
  return ISSUE_GROUP_BY_VALUES.filter(
    (value) => view !== "board" || value !== "none",
  );
}
