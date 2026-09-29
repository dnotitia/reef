import type { IssueListItem } from "../schemas/issues/metadata";

/** Facets whose matching semantics are shared by issue lists and reports. */
export interface SharedIssueFacets {
  assignee?: string | readonly string[];
  assigneeUnset?: boolean;
  sprint_id?: string | readonly string[];
  milestone_id?: string;
  release_id?: string | readonly string[];
  parent_id?: string;
  label?: string;
}

function facetValues(
  value: string | readonly string[] | undefined,
): readonly string[] {
  if (value == null) return [];
  return typeof value === "string" ? [value] : value;
}

function labelsFromFilter(value: string): string[] {
  return value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

/** Match the shared exact-id, case-insensitive assignee, and OR-label facets. */
export function matchesSharedFacets(
  issue: IssueListItem,
  facets: SharedIssueFacets,
): boolean {
  const assignees = facetValues(facets.assignee);
  if (assignees.length || facets.assigneeUnset) {
    const who = issue.assigned_to?.toLowerCase() ?? "";
    const matchesAssigned = assignees.some(
      (assignee) =>
        assignee.trim().length > 0 && assignee.toLowerCase() === who,
    );
    const matchesUnset = Boolean(
      facets.assigneeUnset && !issue.assigned_to?.trim(),
    );
    if (!matchesAssigned && !matchesUnset) return false;
  }

  const sprints = facetValues(facets.sprint_id);
  if (sprints.length && !sprints.includes(issue.sprint_id ?? "")) return false;
  if (facets.milestone_id && issue.milestone_id !== facets.milestone_id)
    return false;
  const releases = facetValues(facets.release_id);
  if (releases.length && !releases.includes(issue.release_id ?? ""))
    return false;
  if (facets.parent_id && issue.parent_id !== facets.parent_id) return false;

  if (facets.label) {
    const labels = labelsFromFilter(facets.label).map((label) =>
      label.toLowerCase(),
    );
    const issueLabels = issue.labels?.map((label) => label.toLowerCase()) ?? [];
    if (
      labels.length > 0 &&
      !labels.some((label) => issueLabels.includes(label))
    )
      return false;
  }
  return true;
}

export function isIssueActive(
  issue: Pick<IssueListItem, "archived_at">,
): boolean {
  return issue.archived_at == null;
}
