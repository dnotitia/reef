import { withVault } from "@/lib/workspaceHref";
import {
  type SavedIssueView,
  type SavedIssueViewPayload,
  StatusEnum,
  USER_SORT_FIELDS,
} from "@reef/core";
import { type UserSortField, naturalSortOrder } from "@reef/core/fields";
import type { IssueFilter } from "../stores/useIssueStore";

export const ISSUE_QUERY_KEYS = [
  "status",
  "type",
  "priority",
  "assignee",
  "requester",
  "sprint_id",
  "milestone_id",
  "release_id",
  "severity",
  "due",
  "labels",
  "dep",
  "archived",
  "stale",
  "sort",
  "order",
  "q",
  "view",
] as const;

const FILTER_QUERY_KEYS = ISSUE_QUERY_KEYS.filter((key) => key !== "view");
const VIEW_MODES = new Set(["board", "list", "timeline", "backlog"]);

export function isIssuesListPath(pathname: string, vault: string): boolean {
  return pathname === withVault(vault, "/issues");
}

export function savedIssueViewDefaultIsStale(
  defaultId: string | undefined,
  views: SavedIssueView[] | undefined,
  readSucceeded: boolean,
): boolean {
  return (
    !!defaultId &&
    readSucceeded &&
    !!views &&
    !views.some((view) => view.id === defaultId)
  );
}

export interface IssueUrlState {
  filter: IssueFilter;
  searchQuery: string;
}

export function normalizeRestoredSort(filter: IssueFilter): IssueFilter {
  if (
    filter.sortField &&
    filter.sortOrder !== "asc" &&
    filter.sortOrder !== "desc"
  ) {
    return { ...filter, sortOrder: naturalSortOrder(filter.sortField) };
  }
  return filter;
}

export function readIssueUrlState(
  searchParams: URLSearchParams,
): IssueUrlState {
  const filter: IssueFilter = {};
  const addMany = (
    key: string,
    validate = (value: string) => value.trim().length > 0,
  ) => searchParams.getAll(key).filter(validate);
  const status = addMany(
    "status",
    (value) => StatusEnum.safeParse(value).success,
  );
  const due = addMany(
    "due",
    (value) => value === "overdue" || value === "due_soon",
  );
  const dependency = addMany(
    "dep",
    (value) => value === "blocked" || value === "blocking",
  );
  if (status.length) filter.status = status;
  const issueType = addMany("type");
  if (issueType.length) filter.issueType = issueType;
  const priority = addMany("priority");
  if (priority.length) filter.priority = priority;
  const assignee = addMany("assignee");
  if (assignee.length) filter.assignee = assignee;
  const requester = addMany("requester");
  if (requester.length) filter.requester = requester;
  const sprintId = addMany("sprint_id");
  if (sprintId.length) filter.sprint_id = sprintId;
  const milestoneId = searchParams.get("milestone_id")?.trim();
  if (milestoneId) filter.milestone_id = milestoneId;
  const releaseId = addMany("release_id");
  if (releaseId.length) filter.release_id = releaseId;
  const severity = addMany("severity");
  if (severity.length) filter.severity = severity;
  if (due.length) filter.due = due as NonNullable<IssueFilter["due"]>;
  const label = searchParams.get("labels")?.trim();
  if (label) filter.label = label;
  if (dependency.length) {
    filter.dependencyFilter = dependency as NonNullable<
      IssueFilter["dependencyFilter"]
    >;
  }
  const sort = searchParams.get("sort");
  const order = searchParams.get("order");
  if (sort && (USER_SORT_FIELDS as readonly string[]).includes(sort)) {
    filter.sortField = sort as UserSortField;
    if (order === "asc" || order === "desc") filter.sortOrder = order;
  }
  const archived = searchParams.get("archived");
  if (archived === "1" || archived === "true") filter.showArchived = true;
  const stale = searchParams.get("stale");
  if (stale === "1" || stale === "true") filter.showStale = true;
  return {
    filter: normalizeRestoredSort(filter),
    searchQuery: searchParams.get("q") ?? "",
  };
}

export function hasIssueQueryParams(searchParams: URLSearchParams): boolean {
  return ISSUE_QUERY_KEYS.some((key) => searchParams.has(key));
}

export function hasIssueFilterQueryParams(
  searchParams: URLSearchParams,
): boolean {
  return FILTER_QUERY_KEYS.some((key) => searchParams.has(key));
}

export function buildIssueSearchParams(
  filter: IssueFilter,
  searchQuery: string,
  base = new URLSearchParams(),
): string {
  const params = new URLSearchParams(base);
  for (const key of FILTER_QUERY_KEYS) params.delete(key);
  const append = (key: string, values?: readonly string[]) => {
    for (const value of values ?? []) if (value) params.append(key, value);
  };
  append("status", filter.status);
  append("type", filter.issueType);
  append("priority", filter.priority);
  append("assignee", filter.assignee);
  append("requester", filter.requester);
  append("sprint_id", filter.sprint_id);
  if (filter.milestone_id) params.set("milestone_id", filter.milestone_id);
  append("release_id", filter.release_id);
  append("severity", filter.severity);
  append("due", filter.due);
  if (filter.label) params.set("labels", filter.label);
  append("dep", filter.dependencyFilter);
  if (filter.showArchived) params.set("archived", "1");
  if (filter.showStale) params.set("stale", "1");
  if (filter.sortField) params.set("sort", filter.sortField);
  if (filter.sortOrder) params.set("order", filter.sortOrder);
  if (searchQuery) params.set("q", searchQuery);
  return params.toString();
}

export function canonicalIssueQuery(query: string | URLSearchParams): string {
  const input =
    typeof query === "string"
      ? new URLSearchParams(query)
      : new URLSearchParams(query);
  const { filter, searchQuery } = readIssueUrlState(input);
  const view = input.get("view");
  const parsed = new URLSearchParams(
    buildIssueSearchParams(filter, searchQuery),
  );
  if (view && VIEW_MODES.has(view)) parsed.set("view", view);
  const canonical = new URLSearchParams();
  for (const key of [...ISSUE_QUERY_KEYS].sort()) {
    for (const value of parsed.getAll(key).sort()) canonical.append(key, value);
  }
  return canonical.toString();
}

export function createSavedIssueViewPayload(
  filter: IssueFilter,
  searchQuery: string,
  view: string,
): SavedIssueViewPayload {
  const params = new URLSearchParams(
    buildIssueSearchParams(filter, searchQuery),
  );
  if (view !== "board" && VIEW_MODES.has(view)) params.set("view", view);
  const query: Record<string, string[]> = {};
  for (const key of ISSUE_QUERY_KEYS) {
    const values = params
      .getAll(key)
      .filter((value) => value.trim().length > 0);
    if (values.length) query[key] = [...values].sort();
  }
  return { version: 1, query };
}

export function savedIssueViewPayloadToSearchParams(
  payload: SavedIssueViewPayload,
): URLSearchParams {
  const raw = new URLSearchParams();
  for (const key of ISSUE_QUERY_KEYS) {
    const values = payload.query[key];
    if (!Array.isArray(values)) continue;
    for (const value of values)
      if (typeof value === "string") raw.append(key, value);
  }
  return new URLSearchParams(canonicalIssueQuery(raw));
}

export function savedIssueViewHref(
  vault: string,
  payload: SavedIssueViewPayload,
): string {
  const query = savedIssueViewPayloadToSearchParams(payload).toString();
  const path = withVault(vault, "/issues");
  return query ? `${path}?${query}` : path;
}

export function savedIssueViewIsActive(
  payload: SavedIssueViewPayload,
  searchParams: URLSearchParams,
): boolean {
  return (
    savedIssueViewPayloadToSearchParams(payload).toString() ===
    canonicalIssueQuery(searchParams)
  );
}
