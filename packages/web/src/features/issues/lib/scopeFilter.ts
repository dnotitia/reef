import { WORKFLOW_STATUS_OPTIONS } from "@reef/core/fields";
import type { IssueFilter } from "../stores/useIssueStore";
import type { IssueScope } from "./viewMode";

const ACTIVE_STATUS_SET = new Set<string>(WORKFLOW_STATUS_OPTIONS);

/**
 * Project the shared issue filter onto the selected work scope. The filter
 * store remains shared so switching scope preserves the user's triage facets,
 * while hidden or contradictory facets are neutralized at the query boundary.
 */
export function filterForIssueScope(
  filter: IssueFilter,
  scope: IssueScope,
): IssueFilter {
  if (scope === "backlog") {
    return {
      ...filter,
      status: ["backlog"],
      sprint_id: undefined,
      release_id: undefined,
      due: undefined,
      showStale: undefined,
    };
  }

  if (!filter.status?.length) {
    return { ...filter, status: [...WORKFLOW_STATUS_OPTIONS] };
  }

  const activeStatuses = filter.status.filter((status) =>
    ACTIVE_STATUS_SET.has(status),
  );

  // An explicit backlog-only selection cannot be silently widened into the
  // Active scope. Reuse the valid backlog enum as a server-side empty result;
  // the client projection below keeps it out of the rendered active set.
  return {
    ...filter,
    status: activeStatuses.length > 0 ? activeStatuses : ["backlog"],
  };
}

/** Scope-aware empty/no-match semantics, excluding the scope's pinned status. */
export function hasScopeFilters(
  filter: IssueFilter,
  searchQuery: string,
  scope: IssueScope,
): boolean {
  return Boolean(
    filter.issueType?.length ||
      filter.priority?.length ||
      filter.assignee?.length ||
      filter.requester?.length ||
      (scope === "active" && filter.sprint_id?.length) ||
      filter.milestone_id ||
      (scope === "active" && filter.release_id?.length) ||
      filter.severity?.length ||
      (scope === "active" && filter.due?.length) ||
      filter.label?.trim() ||
      filter.dependencyFilter?.length ||
      (scope === "active" && filter.status?.length) ||
      searchQuery.trim(),
  );
}
