import {
  normalizeMyViewSnapshot,
  normalizePersistedIssueFilter,
  type MyViewListColumn,
  type MyViewSnapshot,
} from "@reef/core";
import { naturalSortOrder } from "@reef/core/fields";
import type { IssueFilter } from "../stores/useIssueStore";
import { defaultIssueGroupBy, type IssueGroupBy } from "./groupBy";
import type { IssueLayout, IssueScope } from "./viewMode";

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
    filter: normalizedFilter,
    scope,
    layout,
    grouping: input.groupBy ?? defaultIssueGroupBy(scope, layout),
    ordering,
    display: {
      showArchived: normalizedFilter.showArchived ? true : undefined,
      showStale: normalizedFilter.showStale ? true : undefined,
      listColumns: input.listOptionalColumns ?? [],
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
