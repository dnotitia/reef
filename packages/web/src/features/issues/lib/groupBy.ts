export const ISSUE_GROUP_BY_VALUES = [
  "none",
  "status",
  "assignee",
  "priority",
  "sprint",
  "label",
] as const;

export type IssueGroupBy = (typeof ISSUE_GROUP_BY_VALUES)[number];
export type IssueWorkspaceView = "board" | "list" | "timeline" | "backlog";

const ISSUE_GROUP_BY_SET = new Set<string>(ISSUE_GROUP_BY_VALUES);

export function defaultIssueGroupBy(view: IssueWorkspaceView): IssueGroupBy {
  return view === "board" ? "status" : "none";
}

export function parseIssueGroupBy(
  value: string | null | undefined,
  view: IssueWorkspaceView,
): IssueGroupBy {
  if (view !== "board" && view !== "list") {
    return "none";
  }
  if (!value || !ISSUE_GROUP_BY_SET.has(value)) {
    return defaultIssueGroupBy(view);
  }
  if (view === "board" && value === "none") {
    return "status";
  }
  return value as IssueGroupBy;
}

export function normalizeIssueGroupByParam(
  value: string | null | undefined,
  view: IssueWorkspaceView,
): string {
  return parseIssueGroupBy(value, view);
}

export function serializeIssueGroupBy(value: IssueGroupBy): string {
  return value;
}
