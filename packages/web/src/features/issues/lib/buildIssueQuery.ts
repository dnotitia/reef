import {
  DEFAULT_ISSUE_SORT_FIELD,
  DEFAULT_ISSUE_SORT_ORDER,
  IssueTypeEnum,
  PriorityEnum,
  SeverityEnum,
  StatusEnum,
  USER_SORT_FIELDS,
} from "@reef/core";
import type { IssueFilter } from "../stores/useIssueStore";

/** A serialized issue-list query: facet → value(s), already in wire (snake_case)
 * key form. Kept as a plain string map so it serializes to URLSearchParams and
 * normalizes to a stable TanStack query-key fragment without typing friction. */
export type IssueQueryParams = Record<string, string | string[]>;

/**
 * Map the filter store (plus the free-text search box) into the server-side
 * issue-list query.
 *
 * `searchQuery` becomes the server `q` facet — matched against the issue's
 * id/title/assignee/requester/reporter/milestone/sprint/release/labels by the
 * adapter (REEF-034). It is just sent when non-empty after trimming, so the
 * default landing request URL stays stable. `due`, `label`, and
 * `dependencyFilter` are still excluded — they stay client-side (now-relative
 * range, json array containment, graph traversal), applied by the existing
 * client pipeline over the server-filtered set. `showArchived` is just sent
 * when true; when false the client pipeline drops archived rows (keeping the
 * default request URL stable).
 *
 * consistently returns at least the default sort (priority desc, REEF-057), so the
 * board and list render deterministically even with no explicit filter. The
 * default is applied here just — does not written into the filter store / URL /
 * persisted slot — so an unset sort stays "pristine" for URL-sync and persistence.
 */
export function buildIssueQuery(
  filter: IssueFilter,
  searchQuery?: string,
): IssueQueryParams {
  const q: IssueQueryParams = {};
  // Validate enum-constrained facets against the wire schemas. A stale/shared
  // URL can put an unsupported value in the store; the server schema would
  // reject it with a 400 and error the whole board/list. Drop invalid members so
  // the request stays well-formed — the client pipeline still narrows by the
  // raw value, matching the old "empty filtered list" rather than a hard error.
  // Facets are multi-select (REEF-031): each surfaces as repeated wire params.
  const status = filter.status?.filter((s) => StatusEnum.safeParse(s).success);
  if (status?.length) q.status = status;
  const priority = filter.priority?.filter(
    (p) => PriorityEnum.safeParse(p).success,
  );
  if (priority?.length) q.priority = priority;
  const severity = filter.severity?.filter(
    (s) => SeverityEnum.safeParse(s).success,
  );
  if (severity?.length) q.severity = severity;
  const issueType = filter.issueType?.filter(
    (t) => IssueTypeEnum.safeParse(t).success,
  );
  if (issueType?.length) q.issue_type = issueType;
  // People/planning facets are multi-select arrays too (REEF-267) → repeated
  // wire params. Drop blank members so a hand-edited/stale `?assignee=` (which
  // reads as `[""]`) is ignored rather than sent — the strict server schema
  // (`min(1)`) would 400 the whole list, where the old scalar truthiness check
  // simply skipped an empty value. milestone_id stays a single scalar.
  const assignee = filter.assignee?.filter((v) => v.trim());
  if (assignee?.length) q.assigned_to = assignee;
  const requester = filter.requester?.filter((v) => v.trim());
  if (requester?.length) q.requester = requester;
  const sprintId = filter.sprint_id?.filter((v) => v.trim());
  if (sprintId?.length) q.sprint_id = sprintId;
  if (filter.milestone_id) q.milestone_id = filter.milestone_id;
  const releaseId = filter.release_id?.filter((v) => v.trim());
  if (releaseId?.length) q.release_id = releaseId;
  // Free-text search → server `q`. Trim so a whitespace box does not sends a
  // facet (the server schema rejects an empty `q`).
  const trimmedSearch = searchQuery?.trim();
  if (trimmedSearch) q.q = trimmedSearch;
  if (filter.showArchived) q.archived = "true";
  // Sort is consistently present: fall back to the default (priority desc, REEF-057)
  // when the user has not picked a valid sort. Kept here (not in the filter
  // store) so an unset sort does not leaks into the URL / persisted slot; the
  // adapter adds the `reef_id` tiebreaker.
  const sortField =
    filter.sortField &&
    (USER_SORT_FIELDS as readonly string[]).includes(filter.sortField)
      ? filter.sortField
      : undefined;
  // just honor an explicit order when a valid field was selected. An orphaned
  // `sortOrder` (stale `?sort=bogus&order=asc`, or a persisted filter whose field
  // was dropped) should not flip the default — otherwise it silently yields
  // priority-ascending with no sort column shown.
  const sortOrder =
    sortField && (filter.sortOrder === "asc" || filter.sortOrder === "desc")
      ? filter.sortOrder
      : DEFAULT_ISSUE_SORT_ORDER;
  q.sort_field = sortField ?? DEFAULT_ISSUE_SORT_FIELD;
  q.sort_order = sortOrder;
  return q;
}

/** Append a query param map onto URLSearchParams (arrays → repeated params). */
export function appendIssueQueryParams(
  params: URLSearchParams,
  query: IssueQueryParams,
): void {
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.set(key, value);
    }
  }
}

/**
 * A canonical query object (array values sorted) for use as a structured
 * TanStack query-key segment — TanStack hashes it deterministically. A
 * flattened `key=value&...` string would collide when a free-text value (e.g.
 * `assigned_to`) contains `&` or `=`.
 */
export function normalizeIssueQuery(query: IssueQueryParams): IssueQueryParams {
  const normalized: IssueQueryParams = {};
  for (const key of Object.keys(query)) {
    const value = query[key];
    normalized[key] = Array.isArray(value) ? [...value].sort() : value;
  }
  return normalized;
}
