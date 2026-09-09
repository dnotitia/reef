import type { IssueScope } from "../../lib/viewMode";

export const ISSUE_FILTER_CHROME_KEYS = [
  "status",
  "type",
  "priority",
  "severity",
  "due",
  "dependency",
  "assignee",
  "requester",
  "sprint",
  "milestone",
  "release",
  "labels",
  "updatedAtRange",
  "display",
  "sort",
  "myViews",
] as const;

export type IssueFilterChromeKey = (typeof ISSUE_FILTER_CHROME_KEYS)[number];

/**
 * The visible filter-bar contract shared by live and auth-pending Issues
 * chrome. Scope owns which facets exist. The caller owns view-specific rules
 * such as hiding field sorting on Timeline or on a fixed route.
 */
export function issueFilterChromeKeys(
  scope: IssueScope,
): readonly IssueFilterChromeKey[] {
  const backlog = scope === "backlog";
  return ISSUE_FILTER_CHROME_KEYS.filter((key) => {
    if (backlog && ["status", "due", "sprint", "release"].includes(key)) {
      return false;
    }
    return true;
  });
}
