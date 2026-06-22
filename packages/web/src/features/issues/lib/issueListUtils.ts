import {
  type IssueListItem,
  isResolvedStatus,
  isStaleResolved,
} from "@reef/core";
import type { IssueFilter } from "../stores/useIssueStore";

/** True when the issue has not been archived. Shared by Board / Reports /
 *  filterIssues so a future change to the archive predicate stays in one
 *  place. */
export function isActive(issue: IssueListItem): boolean {
  return issue.archived_at == null;
}

/** Custom priority sort rank — higher number = higher priority */
const PRIORITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Sorts issues by the given field and order.
 * Returns a new array; does not mutate the input.
 * Undefined sortField or sortOrder results in the original order.
 */
export function sortIssues(
  issues: IssueListItem[],
  field: IssueFilter["sortField"],
  order: IssueFilter["sortOrder"],
): IssueListItem[] {
  if (!field) return [...issues];
  const dir = order === "desc" ? -1 : 1;
  return [...issues].sort((a, b) => {
    if (field === "priority") {
      const aRank = PRIORITY_RANK[a.priority ?? ""] ?? 0;
      const bRank = PRIORITY_RANK[b.priority ?? ""] ?? 0;
      return (aRank - bRank) * dir;
    }
    if (field === "estimate_points") {
      // Numeric column; nulls sort as 0 (matches the server's COALESCE).
      return ((a.estimate_points ?? 0) - (b.estimate_points ?? 0)) * dir;
    }
    if (field === "title") {
      // Human text (often Korean) — localeCompare gives a natural A→Z / 가→하
      // order rather than a raw lexicographic code-point comparison.
      return a.title.localeCompare(b.title) * dir;
    }
    if (field === "start_date" || field === "due_date") {
      const aVal = a[field] ?? "";
      const bVal = b[field] ?? "";
      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
      return 0;
    }
    // created_at / updated_at — ISO strings sort lexicographically
    const aVal = a[field] ?? "";
    const bVal = b[field] ?? "";
    if (aVal < bVal) return -1 * dir;
    if (aVal > bVal) return 1 * dir;
    return 0;
  });
}

/**
 * The issue facets shared between the `/issues` list filter and the `/reports`
 * scope bar: assignee, label, and the three planning ids. Both surfaces keep
 * their own extra controls (issues adds status/type/priority/…, reports adds
 * period/scope), but these should match identically everywhere — so the
 * predicate lives here once and both call it (REEF-074). `IssueFilter` and the
 * reports `ReportFilters` both structurally satisfy this shape.
 *
 * `assignee` / `sprint_id` / `release_id` accept either a single scalar (reports
 * still selects one) or a multi-select array (the issues filter, REEF-267); the
 * predicate normalizes both and OR-combines within the facet, so the two
 * surfaces share one matching semantics regardless of cardinality. `milestone_id`
 * stays single (multi-select out of scope), and `parent_id` is the one facet
 * `/reports` sets today (the portfolio rollup drill, REEF-187 — no issues-list
 * control), both exact-id single values.
 */
export interface SharedIssueFacets {
  assignee?: string | readonly string[];
  label?: string;
  sprint_id?: string | readonly string[];
  milestone_id?: string;
  release_id?: string | readonly string[];
  parent_id?: string;
}

/** Normalize a facet that may arrive as a single scalar (reports) or a
 *  multi-select array (issues, REEF-267) into an array; an unset facet is an
 *  empty array, which the caller treats as "passes". */
function facetValues(
  value: string | readonly string[] | undefined,
): readonly string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value as string];
}

/**
 * Issue label filters are stored as a comma-joined string (URL/persistence
 * friendly) but edited as discrete chips. These two helpers are the single
 * conversion used by both the issues FilterBar and the reports scope bar.
 */
export function parseLabelFilter(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((label) => label.trim())
      .filter(Boolean) ?? []
  );
}

export function formatLabelFilter(
  labels: readonly string[],
): string | undefined {
  return labels.length > 0 ? labels.join(",") : undefined;
}

/** OR-match the issue's labels against a comma-separated filter; case- and
 *  whitespace-insensitive, exact per token. Empty filter passes. */
function matchesLabelFilter(issue: IssueListItem, label: string): boolean {
  const filterLabels = parseLabelFilter(label).map((l) => l.toLowerCase());
  if (filterLabels.length === 0) return true;
  const issueLabels = issue.labels?.map((l) => l.toLowerCase()) ?? [];
  return filterLabels.some((fl) => issueLabels.includes(fl));
}

/**
 * Match an issue against the facets shared by the issues list and reports.
 * Assignee is a case-insensitive EXACT match of `assigned_to` (REEF-267 — no
 * longer a substring, so filtering to `ann` never incidentally returns `joann`),
 * OR-combined across the selected logins; sprint / release are exact id equality
 * OR-combined across selected ids; milestone / parent are single exact ids; label
 * is comma-separated OR (see `matchesLabelFilter`). An unset facet consistently
 * passes. The exact predicate is the single source both surfaces share, so the
 * issues filter and reports never diverge (AC5).
 */
export function matchesSharedFacets(
  issue: IssueListItem,
  facets: SharedIssueFacets,
): boolean {
  const assignees = facetValues(facets.assignee);
  if (assignees.length) {
    const who = issue.assigned_to?.toLowerCase() ?? "";
    if (!assignees.some((a) => a.toLowerCase() === who)) return false;
  }
  const sprints = facetValues(facets.sprint_id);
  if (sprints.length && !sprints.includes(issue.sprint_id ?? "")) return false;
  if (facets.milestone_id && issue.milestone_id !== facets.milestone_id)
    return false;
  const releases = facetValues(facets.release_id);
  if (releases.length && !releases.includes(issue.release_id ?? ""))
    return false;
  if (facets.parent_id && issue.parent_id !== facets.parent_id) return false;
  if (facets.label && !matchesLabelFilter(issue, facets.label)) return false;
  return true;
}

/**
 * Filters issues by metadata fields (status, priority, assignee, labels).
 * Returns a new array; does not mutate the input.
 *
 * `opts.searchActive` reports whether the caller is about to narrow the result
 * with a live in-view text query (`searchIssues`). When it is, the stale-resolved
 * auto-hide is bypassed so a long-finished issue the user is explicitly searching
 * for still surfaces — recoverability over declutter once there is a query. The
 * archived gate is deliberately NOT bypassed: archiving is an explicit "put away"
 * action, so it stays hidden until the user toggles Show archived, whereas the
 * stale auto-hide is passive and a search expresses intent to find it (REEF-275).
 */
export function filterIssues(
  issues: IssueListItem[],
  filter: IssueFilter,
  opts: { searchActive?: boolean } = {},
): IssueListItem[] {
  // Now-relative cut, evaluated once for the whole pass so every row in this
  // render is compared against the same instant (shared by the stale-resolved
  // auto-hide and the `due` overdue/due-soon window below).
  const now = Date.now();
  return issues.filter((issue) => {
    if (!filter.showArchived && !isActive(issue)) return false;
    // Hide resolved issues that have aged past their auto-hide window unless the
    // user opted in via "Show completed" — orthogonal to the archived toggle
    // (REEF-275). The ⌘K palette and deep links bypass this whole pipeline; an
    // active in-view search bypasses just this gate (see `opts.searchActive`), so
    // a stale issue stays findable wherever a query is doing the looking.
    if (
      !filter.showStale &&
      !opts.searchActive &&
      isStaleResolved({
        status: issue.status,
        closedReason: issue.closed_reason,
        lastStatusChange: issue.last_status_change,
        now,
      })
    )
      return false;
    // Multi-select facets (REEF-031): an issue matches when its value is one of
    // the selected members (OR within a facet, AND across facets).
    if (filter.status?.length && !filter.status.includes(issue.status))
      return false;
    if (
      filter.issueType?.length &&
      !filter.issueType.includes(issue.issue_type ?? "task")
    )
      return false;
    if (
      filter.priority?.length &&
      !filter.priority.includes(issue.priority ?? "")
    )
      return false;
    if (
      filter.severity?.length &&
      !filter.severity.includes(issue.severity ?? "")
    )
      return false;
    // Requester mirrors assignee: case-insensitive exact match, OR-combined
    // across the selected logins (REEF-267 — no longer a substring).
    if (filter.requester?.length) {
      const who = issue.requester?.toLowerCase() ?? "";
      if (!filter.requester.some((r) => r.toLowerCase() === who)) return false;
    }
    if (filter.due?.length) {
      if (!issue.due_date) return false;
      if (isResolvedStatus(issue.status)) return false;
      const due = new Date(issue.due_date).getTime();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const isOverdue = due < now;
      const isDueSoon = due >= now && due <= now + sevenDays;
      const matchesDue =
        (filter.due.includes("overdue") && isOverdue) ||
        (filter.due.includes("due_soon") && isDueSoon);
      if (!matchesDue) return false;
    }
    // Assignee, sprint, milestone, release, and label share their matching
    // semantics with the reports scope bar (REEF-074).
    if (!matchesSharedFacets(issue, filter)) return false;
    return true;
  });
}

/**
 * Client-side free-text search over the displayed set — a safety net mirroring
 * the server `q` predicate (same fields). The server narrows `q` server-side,
 * but `useIssueList` keeps prior same-vault rows as placeholderData while a new
 * query key is fetching (and surfaces cached rows on error), so without this
 * pass a new or failed search would briefly show rows that do not match the
 * query. Symmetric with the `filterIssues` facet safety net in the same client
 * pipeline.
 */
export function searchIssues(
  issues: IssueListItem[],
  query: string,
): IssueListItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return issues;
  return issues.filter((issue) => {
    if (issue.id.toLowerCase().includes(q)) return true;
    if (issue.title.toLowerCase().includes(q)) return true;
    if (issue.assigned_to?.toLowerCase().includes(q)) return true;
    if (issue.requester?.toLowerCase().includes(q)) return true;
    if (issue.reporter?.toLowerCase().includes(q)) return true;
    if (issue.milestone_id?.toLowerCase().includes(q)) return true;
    if (issue.sprint_id?.toLowerCase().includes(q)) return true;
    if (issue.release_id?.toLowerCase().includes(q)) return true;
    if (issue.labels?.some((label) => label.toLowerCase().includes(q)))
      return true;
    return false;
  });
}
