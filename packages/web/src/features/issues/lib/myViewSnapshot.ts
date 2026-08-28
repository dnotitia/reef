import {
  MyViewListColumnEnum,
  normalizeMyViewSnapshot,
  normalizePersistedIssueFilter,
  serializeMyViewSnapshot,
  type MyViewFilter,
  type MyViewListColumn,
  type MyViewSnapshot,
} from "@reef/core";
import { naturalSortOrder } from "@reef/core/fields";
import type { IssueFilter } from "../stores/useIssueStore";
import { defaultIssueGroupBy, type IssueGroupBy } from "./groupBy";
import type { IssueLayout, IssueScope } from "./viewMode";

const MY_VIEW_FILTER_KEYS = [
  "status",
  "issueType",
  "priority",
  "assignee",
  "requester",
  "reporter",
  "severity",
  "sprint_id",
  "milestone_id",
  "release_id",
  "due",
  "label",
  "dependencyFilter",
] as const;

function filterForSnapshot(filter: IssueFilter): MyViewFilter {
  const normalized = normalizePersistedIssueFilter(filter);
  const snapshotFilter: Record<string, unknown> = {};
  for (const key of MY_VIEW_FILTER_KEYS) {
    const value = normalized[key];
    if (value !== undefined) snapshotFilter[key] = value;
  }
  return snapshotFilter as MyViewFilter;
}

function listColumnsForSnapshot(
  columns: readonly string[],
): MyViewSnapshot["display"]["listColumns"] {
  const selected = new Set(columns);
  const normalized = MyViewListColumnEnum.options.filter((column) =>
    selected.has(column),
  );
  return normalized.length > 0 ? normalized : undefined;
}

/** Converts the current issue workspace state into the stored My View shape. */
export function buildMyViewSnapshot(input: {
  filter: IssueFilter;
  scope: IssueScope;
  layout: IssueLayout;
  groupBy?: IssueGroupBy;
  listOptionalColumns?: readonly string[];
}): MyViewSnapshot {
  const { scope, layout } = input;
  const normalizedFilter = normalizePersistedIssueFilter(input.filter);
  const ordering = normalizedFilter.sortField
    ? {
        mode: "field" as const,
        field: normalizedFilter.sortField,
        direction:
          normalizedFilter.sortOrder ??
          naturalSortOrder(normalizedFilter.sortField),
      }
    : { mode: "manual" as const };
  const snapshot = normalizeMyViewSnapshot({
    filter: filterForSnapshot(normalizedFilter),
    scope,
    layout,
    grouping: input.groupBy ?? defaultIssueGroupBy(scope, layout),
    ordering,
    display: {
      showArchived: normalizedFilter.showArchived ? true : undefined,
      showStale: normalizedFilter.showStale ? true : undefined,
      listColumns: listColumnsForSnapshot(input.listOptionalColumns ?? []),
    },
  });
  if (!snapshot) throw new TypeError("My View snapshot could not be built");
  return snapshot;
}

/** Applies a validated snapshot to the issue store and workspace URL axes. */
export function applyMyViewSnapshot(snapshot: MyViewSnapshot): {
  filter: IssueFilter;
  scope: IssueScope;
  layout: IssueLayout;
  groupBy: IssueGroupBy;
  listOptionalColumns: readonly MyViewListColumn[];
} {
  const normalized = normalizeMyViewSnapshot(snapshot);
  if (!normalized) throw new TypeError("My View snapshot is invalid");
  const filter: IssueFilter = { ...normalized.filter };
  if (normalized.ordering.mode === "field") {
    filter.orderingMode = "field";
    filter.sortField = normalized.ordering.field;
    filter.sortOrder = normalized.ordering.direction;
  } else {
    filter.orderingMode = "manual";
    filter.sortField = undefined;
    filter.sortOrder = undefined;
  }
  filter.showArchived = normalized.display.showArchived;
  filter.showStale = normalized.display.showStale;
  return {
    filter,
    scope: normalized.scope,
    layout: normalized.layout,
    groupBy: normalized.grouping,
    listOptionalColumns: normalized.display.listColumns ?? [],
  };
}

export function serializeCurrentMyViewSnapshot(input: {
  filter: IssueFilter;
  scope: IssueScope;
  layout: IssueLayout;
  groupBy?: IssueGroupBy;
  listOptionalColumns?: readonly string[];
}): string {
  return serializeMyViewSnapshot(buildMyViewSnapshot(input));
}
