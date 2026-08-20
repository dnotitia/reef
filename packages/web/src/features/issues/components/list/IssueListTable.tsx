"use client";

import { SearchProgressBar } from "@/components/ui/SearchProgressBar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IssueListColumnsControl } from "@/features/issues/components/list/IssueListColumnsControl";
import { IssueListRow } from "@/features/issues/components/list/IssueListRow";
import { IssueListSkeleton } from "@/features/issues/components/list/IssueListSkeleton";
import { IssueSelectionCheckbox } from "@/features/issues/components/shared/IssueSelectionCheckbox";
import {
  ISSUE_TABLE_COLUMN_WIDTHS,
  ISSUE_TABLE_HEADER_HEIGHT,
  ISSUE_TABLE_ROW_HEIGHT,
  ISSUE_TABLE_TITLE_MIN_WIDTH,
  type IssueListColumnKey,
  type IssueListOptionalColumnKey,
  isIssueTableStickyColumn,
  issueTableColumnOffset,
  issueTableWidth,
  resolveIssueListColumns,
} from "@/features/issues/components/shared/issueTableContract";
import { useInfiniteIssueList } from "@/features/issues/hooks/queries/useInfiniteIssueList";
import { useIssueRelations } from "@/features/issues/hooks/queries/useIssueRelations";
import { useResolvedAutoHideWindows } from "@/features/issues/hooks/useResolvedAutoHideWindows";
import { useOpenIssue } from "@/features/issues/hooks/view/useOpenIssue";
import { useVaultRoster } from "@/features/settings/hooks/useVaultRoster";
import { buildIssueQuery } from "@/features/issues/lib/buildIssueQuery";
import { applyDependencyFilter } from "@/features/issues/lib/dependencyUtils";
import type { IssueGroupBy } from "@/features/issues/lib/groupBy";
import { createIssueGroupDescriptor } from "@/features/issues/lib/grouping";
import { flattenIssueListPages } from "@/features/issues/lib/issueListCache";
import { buildIssueListVirtualItems } from "@/features/issues/lib/listGrouping";
import {
  filterIssues,
  hasActiveIssueFilters,
  searchIssues,
  sortIssues,
} from "@/features/issues/lib/issueListUtils";
import { loadedSelectionState } from "@/features/issues/lib/issueSelection";
import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { usePlanningCatalog } from "@/features/planning/hooks/usePlanningCatalog";
import { useUserSearch } from "@/features/issues/hooks/queries/useUserSearch";
import { PageBody } from "@/features/ui/components/PageBody";
import {
  useFieldNameLabels,
  usePriorityLabels,
  useStatusLabels,
} from "@/i18n/fieldLabels";
import { activateButtonOnKeyDown } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const VIRTUAL_OVERSCAN = 8;
const LOAD_AHEAD_COUNT = 8;
const FALLBACK_RENDER_COUNT = 12;

interface IssueListTableProps {
  vault: string;
  groupBy?: IssueGroupBy;
}

function IssueListColumnGroup({
  columns,
}: {
  columns: readonly IssueListColumnKey[];
}) {
  return (
    <colgroup>
      {columns.map((column) => (
        <col
          key={column}
          data-column-key={column}
          style={
            column === "title"
              ? { minWidth: ISSUE_TABLE_TITLE_MIN_WIDTH }
              : { width: ISSUE_TABLE_COLUMN_WIDTHS[column] }
          }
        />
      ))}
    </colgroup>
  );
}

function issueTableColumnClass(
  column: IssueListColumnKey,
  kind: "header" | "cell",
) {
  return cn(
    kind === "header" ? "h-8 px-3 py-0" : "h-10 min-w-0 px-3 py-0 align-middle",
    isIssueTableStickyColumn(column) &&
      (kind === "header"
        ? "sticky z-20 bg-surface-page"
        : "sticky z-10 bg-surface-page group-hover:bg-surface-hover"),
    column === "title" && "min-w-[15rem]",
  );
}

function issueTableColumnStyle(
  columns: readonly IssueListColumnKey[],
  column: IssueListColumnKey,
) {
  return {
    ...(column === "title"
      ? { minWidth: ISSUE_TABLE_TITLE_MIN_WIDTH }
      : { width: ISSUE_TABLE_COLUMN_WIDTHS[column] }),
    ...(isIssueTableStickyColumn(column)
      ? {
          left: issueTableColumnOffset(columns, column),
          position: "sticky" as const,
        }
      : {}),
  };
}

function SpacerRow({
  height,
  columnCount,
}: {
  height: number;
  columnCount: number;
}) {
  if (height <= 0) return null;
  return (
    <tr className="pointer-events-none">
      <td colSpan={columnCount} className="border-0 p-0" style={{ height }} />
    </tr>
  );
}

function IssueListGroupHeader({
  label,
  bucketId,
  count,
  collapsed,
  columnCount,
  onToggle,
}: {
  label: string;
  bucketId: string;
  count: number;
  collapsed: boolean;
  columnCount: number;
  onToggle: () => void;
}) {
  const t = useTranslations("issues.list");
  const actionLabel = collapsed
    ? t("expandGroup", { label })
    : t("collapseGroup", { label });
  const groupSummary = t("groupHeader", { label, count });

  return (
    <TableRow
      className="sticky top-8 z-20 h-8 bg-surface-page"
      data-testid="issue-group-header"
      data-group-id={bucketId}
      data-group-collapsed={collapsed ? "true" : "false"}
    >
      <TableCell
        colSpan={columnCount}
        className="h-8 border-y border-border-subtle p-0"
      >
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 px-3 text-left text-xs font-semibold text-foreground transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus/40"
          aria-expanded={!collapsed}
          aria-label={`${actionLabel} · ${groupSummary}`}
          onKeyDown={activateButtonOnKeyDown}
          onClick={onToggle}
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 transition-transform duration-150",
              !collapsed && "rotate-90",
            )}
          />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {count}
          </span>
        </button>
      </TableCell>
    </TableRow>
  );
}

/**
 * Table view body for the issues workspace. The list is the one user-facing
 * infinite surface; board/backlog/timeline/report consumers keep their finite
 * `useIssueList` query and data shape.
 */
export function IssueListTable({
  vault,
  groupBy = "none",
}: IssueListTableProps) {
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  const openIssue = useOpenIssue();
  const columnLabels = useFieldNameLabels();
  const statusLabels = useStatusLabels();
  const priorityLabels = usePriorityLabels();
  const t = useTranslations("issues.list");
  const groupT = useTranslations("issues.filters");
  const common = useTranslations("common");
  const bulk = useTranslations("issues.bulk");
  const selectedIds = useIssueSelectionStore((state) => state.selectedIds);
  const selectionRunning = useIssueSelectionStore((state) => state.running);
  const scrollElementRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<{ id: string; offset: number } | null>(null);
  const [optionalColumns, setOptionalColumns] = useState<
    readonly IssueListOptionalColumnKey[]
  >([]);
  const columns = useMemo(
    () => resolveIssueListColumns(optionalColumns),
    [optionalColumns],
  );
  const tableWidth = useMemo(() => issueTableWidth(columns), [columns]);
  const tableClassName = cn(
    "reef-issue-list-table table-fixed",
    optionalColumns.length > 0 && "reef-issue-list-table-expanded",
  );
  const toggleOptionalColumn = useCallback(
    (column: IssueListOptionalColumnKey) => {
      setOptionalColumns((current) =>
        current.includes(column)
          ? current.filter((item) => item !== column)
          : [...current, column],
      );
    },
    [],
  );

  const query = useMemo(
    () => buildIssueQuery(filter, searchQuery),
    [filter, searchQuery],
  );
  const {
    data,
    isPending,
    isFetching,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useInfiniteIssueList(vault, query);
  const staleWindowDays = useResolvedAutoHideWindows(vault);
  const { data: relations } = useIssueRelations(vault);
  const { data: planningCatalog } = usePlanningCatalog(vault);
  const { data: assignees } = useUserSearch("", vault);
  const { data: vaultMembers } = useVaultRoster(vault);

  const allIssues = useMemo(() => flattenIssueListPages(data), [data]);
  const graph = relations ?? allIssues;
  const sorted = useMemo(() => {
    const filtered = filterIssues(allIssues, filter, {
      searchActive: searchQuery.trim().length > 0,
      staleWindowDays,
    });
    const searched = searchIssues(filtered, searchQuery);
    const depFiltered = applyDependencyFilter(
      searched,
      filter.dependencyFilter ?? null,
      graph,
    );
    return sortIssues(depFiltered, filter.sortField, filter.sortOrder);
  }, [allIssues, filter, graph, searchQuery, staleWindowDays]);
  const sprintNames = useMemo(
    () =>
      Object.fromEntries(
        (planningCatalog?.sprints ?? []).map((sprint) => [
          sprint.id,
          sprint.name,
        ]),
      ),
    [planningCatalog],
  );
  const assigneeNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const member of vaultMembers ?? []) {
      const username = member.username;
      if (!username.trim()) continue;
      names[username] = member.display_name?.trim() || username;
    }
    return names;
  }, [vaultMembers]);
  const descriptor = useMemo(
    () =>
      createIssueGroupDescriptor(groupBy, {
        labels: {
          none: groupT("group.none"),
          status: statusLabels,
          priority: priorityLabels,
        },
        assigneeNames,
        sprintNames,
      }),
    [assigneeNames, groupBy, groupT, priorityLabels, sprintNames, statusLabels],
  );
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Group collapse is intentionally reset when the view scope changes; it is
  // UI-local state and does not follow a vault or group into persistence.
  // biome-ignore lint/correctness/useExhaustiveDependencies: groupBy and vault are the reset boundaries for this local state.
  useEffect(() => {
    setCollapsedGroupIds(new Set());
  }, [groupBy, vault]);
  const groups = useMemo(
    () => descriptor.bucketsForIssues(sorted),
    [descriptor, sorted],
  );
  const projectionItems = useMemo(
    () => buildIssueListVirtualItems(groups, collapsedGroupIds),
    [collapsedGroupIds, groups],
  );
  const toggleGroup = useCallback((bucketId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(bucketId)) next.delete(bucketId);
      else next.add(bucketId);
      return next;
    });
  }, []);
  const visibleIssueIds = useMemo(
    () => sorted.map((issue) => issue.id),
    [sorted],
  );
  const selectedIssueId = useIssueKeyboardStore(
    (state) => state.focusedIssueId.list,
  );
  const focusedOccurrenceKey = useIssueKeyboardStore(
    (state) => state.focusedOccurrenceKey.list,
  );
  const focusRequest = useIssueKeyboardStore((state) => state.focusRequest);
  const selectAllState = loadedSelectionState(selectedIds, visibleIssueIds);
  const hasActiveFilters = hasActiveIssueFilters(filter, searchQuery);

  // TanStack Virtual exposes imperative methods outside React Compiler's
  // safe memoization model; keep the compiler skip local to this integration point.
  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer API is the established list implementation.
  const virtualizer = useVirtualizer({
    count: projectionItems.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: (index) =>
      projectionItems[index]?.kind === "header"
        ? ISSUE_TABLE_HEADER_HEIGHT
        : ISSUE_TABLE_ROW_HEIGHT,
    getItemKey: (index) => projectionItems[index]?.key ?? index,
    overscan: VIRTUAL_OVERSCAN,
    scrollMargin: ISSUE_TABLE_HEADER_HEIGHT,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualItems.at(-1)?.index ?? -1;
  const focusedIssueIndex = focusedOccurrenceKey
    ? projectionItems.findIndex(
        (item) =>
          item.kind === "issue" && item.occurrenceKey === focusedOccurrenceKey,
      )
    : selectedIssueId
      ? projectionItems.findIndex(
          (item) => item.kind === "issue" && item.issue.id === selectedIssueId,
        )
      : -1;

  const captureAnchor = useCallback(() => {
    const firstItem = virtualizer.getVirtualItems()[0];
    const firstProjectionItem = firstItem
      ? projectionItems[firstItem.index]
      : undefined;
    anchorRef.current = firstProjectionItem
      ? {
          id: firstProjectionItem.key,
          offset: (virtualizer.scrollOffset ?? 0) - firstItem.start,
        }
      : null;
  }, [projectionItems, virtualizer]);

  useEffect(() => {
    useIssueKeyboardStore.getState().setVisibleOccurrences(
      "list",
      projectionItems.flatMap((item) =>
        item.kind === "issue"
          ? [{ key: item.occurrenceKey, issueId: item.issue.id }]
          : [],
      ),
    );
  }, [projectionItems]);

  useEffect(() => {
    return () => {
      useIssueKeyboardStore.getState().setVisibleOccurrences("list", []);
    };
  }, []);

  useEffect(() => {
    if (
      !hasNextPage ||
      isFetchingNextPage ||
      isFetchNextPageError ||
      isPending ||
      isError
    ) {
      return;
    }
    const nearProjectionEnd =
      projectionItems.length === 0 ||
      lastVirtualIndex >=
        Math.max(0, projectionItems.length - LOAD_AHEAD_COUNT);
    const focusedAtProjectionEnd =
      focusedIssueIndex >= 0 && focusedIssueIndex >= projectionItems.length - 1;
    if (nearProjectionEnd || focusedAtProjectionEnd) {
      void fetchNextPage();
    }
  }, [
    fetchNextPage,
    focusedIssueIndex,
    hasNextPage,
    isError,
    isFetchNextPageError,
    isFetchingNextPage,
    isPending,
    lastVirtualIndex,
    projectionItems.length,
  ]);

  useEffect(() => {
    if (focusRequest?.scope !== "list") return;
    const requestedKey = focusRequest.occurrenceKey ?? focusRequest.issueId;
    const index = projectionItems.findIndex(
      (item) =>
        item.kind === "issue" &&
        (item.occurrenceKey === requestedKey ||
          (!focusRequest.occurrenceKey &&
            item.issue.id === focusRequest.issueId)),
    );
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: "auto" });
    }
  }, [focusRequest, projectionItems, virtualizer]);

  useEffect(() => {
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) return;
    captureAnchor();
    scrollElement.addEventListener("scroll", captureAnchor, { passive: true });
    return () => scrollElement.removeEventListener("scroll", captureAnchor);
  }, [captureAnchor]);

  // Capture the top logical row before a membership/order update and restore its
  // offset after the virtual range is recalculated. This keeps a quick edit from
  // returning a deep list to the top while the focused row is kept addressable.
  useLayoutEffect(() => {
    const previousAnchor = anchorRef.current;
    if (previousAnchor) {
      const nextIndex = projectionItems.findIndex(
        (item) => item.key === previousAnchor.id,
      );
      if (nextIndex >= 0) {
        const nextOffset = virtualizer.getOffsetForIndex(nextIndex, "start");
        if (nextOffset) {
          virtualizer.scrollToOffset(nextOffset[0] + previousAnchor.offset);
        }
      }
    }

    captureAnchor();
  }, [
    captureAnchor,
    projectionItems,
    virtualizer,
    virtualizer.getOffsetForIndex,
    virtualizer.scrollToOffset,
  ]);

  const fallbackCount = Math.min(projectionItems.length, FALLBACK_RENDER_COUNT);
  const renderedIndexes =
    virtualItems.length > 0
      ? virtualItems.map((item) => item.index)
      : Array.from({ length: fallbackCount }, (_, index) => index);
  const firstVirtualItem = virtualItems[0];
  const lastVirtualItem = virtualItems.at(-1);
  const totalSize =
    virtualizer.getTotalSize() ||
    ISSUE_TABLE_HEADER_HEIGHT + projectionItems.length * ISSUE_TABLE_ROW_HEIGHT;
  const topSpacerHeight = firstVirtualItem
    ? Math.max(0, firstVirtualItem.start - ISSUE_TABLE_HEADER_HEIGHT)
    : 0;
  const fallbackLastEnd =
    ISSUE_TABLE_HEADER_HEIGHT + fallbackCount * ISSUE_TABLE_ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(
    0,
    totalSize - (lastVirtualItem?.end ?? fallbackLastEnd),
  );
  const initialLoadError = isError && !data?.pages.length;
  const showTable =
    projectionItems.length > 0 ||
    hasNextPage === true ||
    isFetchingNextPage ||
    isFetchNextPageError;

  const tableHeader = (
    <TableHeader>
      <TableRow>
        {columns.map((column) => (
          <TableHead
            key={column}
            className={issueTableColumnClass(column, "header")}
            style={issueTableColumnStyle(columns, column)}
            data-column-key={column}
          >
            {column === "select" ? (
              <IssueSelectionCheckbox
                checked={selectAllState === "checked"}
                indeterminate={selectAllState === "mixed"}
                disabled={selectionRunning}
                label={bulk("selectAllLoaded")}
                testId="issue-select-all"
                onChange={() =>
                  useIssueSelectionStore
                    .getState()
                    .toggleAllLoaded(visibleIssueIds)
                }
              />
            ) : (
              columnLabels[column]
            )}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );

  return (
    <PageBody
      pad="compact"
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div className="pointer-events-none sticky top-0 z-10 h-0 overflow-visible">
        <SearchProgressBar
          active={isFetching && !isPending && !isFetchingNextPage}
          className="top-0 bottom-auto"
        />
      </div>
      <div className="flex min-h-8 shrink-0 items-center justify-end pb-2">
        <IssueListColumnsControl
          selectedColumns={optionalColumns}
          onToggle={toggleOptionalColumn}
        />
      </div>
      {isPending ? (
        <div
          className="min-h-0 min-w-0 flex-1 overflow-hidden"
          role="status"
          aria-live="polite"
        >
          <span className="sr-only">{t("loading")}</span>
          <div
            className="min-h-0 h-full min-w-0 overflow-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus/30"
            role="region"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: The labeled overflow region is the keyboard scrollport.
            tabIndex={0}
            aria-label={t("scrollRegion")}
            data-testid="issue-list-scroll-container"
          >
            <Table
              className={tableClassName}
              style={{ minWidth: tableWidth }}
              containerClassName="overflow-visible"
            >
              <IssueListColumnGroup columns={columns} />
              <TableHeader>
                <TableRow>
                  {columns.map((column) => (
                    <TableHead
                      key={column}
                      className={issueTableColumnClass(column, "header")}
                      style={issueTableColumnStyle(columns, column)}
                      data-column-key={column}
                    >
                      {column === "select" ? (
                        <IssueSelectionCheckbox
                          checked={false}
                          indeterminate={false}
                          disabled
                          label={bulk("selectAllLoaded")}
                          onChange={() => {}}
                        />
                      ) : (
                        columnLabels[column]
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <IssueListSkeleton columns={columns} />
              </TableBody>
            </Table>
          </div>
        </div>
      ) : initialLoadError ? (
        <div
          className="flex flex-col items-center justify-center gap-3 py-12"
          role="alert"
          aria-live="assertive"
        >
          <p className="text-sm text-muted-foreground">{t("loadError")}</p>
          <button
            type="button"
            className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover"
            onClick={() => refetch()}
          >
            {common("retry")}
          </button>
        </div>
      ) : !showTable ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          {hasActiveFilters ? (
            <>
              <p className="text-sm text-muted-foreground">{t("noMatches")}</p>
              <button
                type="button"
                className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover"
                onClick={() => {
                  useIssueStore.getState().clearFilter();
                }}
              >
                {common("clearFilters")}
              </button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("emptyWorkspace")}
            </p>
          )}
        </div>
      ) : (
        <div
          ref={scrollElementRef}
          className="min-h-0 h-full min-w-0 flex-1 overflow-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus/30"
          role="region"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The labeled overflow region is the keyboard scrollport.
          tabIndex={0}
          aria-label={t("scrollRegion")}
          data-testid="issue-list-scroll-container"
        >
          <Table
            className={tableClassName}
            style={{ minWidth: tableWidth }}
            containerClassName="overflow-visible"
          >
            <IssueListColumnGroup columns={columns} />
            {tableHeader}
            <TableBody>
              <SpacerRow
                height={topSpacerHeight}
                columnCount={columns.length}
              />
              {renderedIndexes.map((index) => {
                const item = projectionItems[index];
                if (!item) return null;
                if (item.kind === "header") {
                  return (
                    <IssueListGroupHeader
                      key={item.key}
                      label={item.bucket.label}
                      bucketId={item.bucket.id}
                      count={item.count}
                      collapsed={item.collapsed}
                      columnCount={columns.length}
                      onToggle={() => toggleGroup(item.bucket.id)}
                    />
                  );
                }
                return (
                  <IssueListRow
                    key={item.key}
                    issue={item.issue}
                    vault={vault}
                    allIssues={graph}
                    planningCatalog={planningCatalog}
                    assignees={assignees}
                    assigneeNames={assigneeNames}
                    highlightQuery={searchQuery}
                    logicalIds={visibleIssueIds}
                    occurrenceKey={item.occurrenceKey}
                    columns={columns}
                    onClick={openIssue}
                  />
                );
              })}
              <SpacerRow
                height={bottomSpacerHeight}
                columnCount={columns.length}
              />
              {sorted.length === 0 && isFetchingNextPage && (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-4">
                    <output className="text-sm text-muted-foreground">
                      {t("loadingMore")}
                    </output>
                  </td>
                </tr>
              )}
              {isFetchNextPageError && (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-4">
                    <div className="flex items-center gap-3" role="alert">
                      <span className="text-sm text-muted-foreground">
                        {t("loadMoreError")}
                      </span>
                      <button
                        type="button"
                        className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover"
                        onClick={() => fetchNextPage()}
                      >
                        {common("retry")}
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </PageBody>
  );
}
