"use client";

import { SearchProgressBar } from "@/components/ui/SearchProgressBar";
import {
  Table,
  TableBody,
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
import { buildIssueQuery } from "@/features/issues/lib/buildIssueQuery";
import { applyDependencyFilter } from "@/features/issues/lib/dependencyUtils";
import { flattenIssueListPages } from "@/features/issues/lib/issueListCache";
import {
  filterIssues,
  searchIssues,
  sortIssues,
} from "@/features/issues/lib/issueListUtils";
import { loadedSelectionState } from "@/features/issues/lib/issueSelection";
import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { usePlanningCatalog } from "@/features/planning/hooks/usePlanningCatalog";
import { PageBody } from "@/features/ui/components/PageBody";
import { useFieldNameLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
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
        ? "sticky z-20 bg-background"
        : "sticky z-10 bg-background group-hover:bg-surface-hover"),
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
      ? { left: issueTableColumnOffset(columns, column) }
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

/**
 * Table view body for the issues workspace. The list is the one user-facing
 * infinite surface; board/backlog/timeline/report consumers keep their finite
 * `useIssueList` query and data shape.
 */
export function IssueListTable({ vault }: IssueListTableProps) {
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  const openIssue = useOpenIssue();
  const columnLabels = useFieldNameLabels();
  const t = useTranslations("issues.list");
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
  const visibleIssueIds = useMemo(
    () => sorted.map((issue) => issue.id),
    [sorted],
  );
  const selectedIssueId = useIssueKeyboardStore(
    (state) => state.focusedIssueId.list,
  );
  const focusRequest = useIssueKeyboardStore((state) => state.focusRequest);
  const selectAllState = loadedSelectionState(selectedIds, visibleIssueIds);
  const hasActiveFilters = !!(
    filter.status?.length ||
    filter.issueType?.length ||
    filter.priority?.length ||
    filter.assignee ||
    filter.requester ||
    filter.sprint_id ||
    filter.milestone_id ||
    filter.release_id ||
    filter.severity?.length ||
    filter.due?.length ||
    filter.label ||
    filter.dependencyFilter?.length ||
    searchQuery
  );

  // TanStack Virtual exposes imperative methods outside React Compiler's
  // safe memoization model; keep the compiler skip local to this integration point.
  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer API is the established list implementation.
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => ISSUE_TABLE_ROW_HEIGHT,
    getItemKey: (index) => sorted[index]?.id ?? index,
    overscan: VIRTUAL_OVERSCAN,
    scrollMargin: ISSUE_TABLE_HEADER_HEIGHT,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualItems.at(-1)?.index ?? -1;
  const focusedIssueIndex = selectedIssueId
    ? visibleIssueIds.indexOf(selectedIssueId)
    : -1;

  const captureAnchor = useCallback(() => {
    const firstItem = virtualizer.getVirtualItems()[0];
    const firstIssue = firstItem ? sorted[firstItem.index] : undefined;
    anchorRef.current = firstIssue
      ? {
          id: firstIssue.id,
          offset: (virtualizer.scrollOffset ?? 0) - firstItem.start,
        }
      : null;
  }, [sorted, virtualizer]);

  useEffect(() => {
    useIssueKeyboardStore
      .getState()
      .setVisibleIssueIds("list", visibleIssueIds);
  }, [visibleIssueIds]);

  useEffect(() => {
    return () => {
      useIssueKeyboardStore.getState().setVisibleIssueIds("list", []);
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
      sorted.length === 0 ||
      lastVirtualIndex >= Math.max(0, sorted.length - LOAD_AHEAD_COUNT);
    const focusedAtProjectionEnd =
      focusedIssueIndex >= 0 && focusedIssueIndex >= sorted.length - 1;
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
    sorted.length,
  ]);

  useEffect(() => {
    if (focusRequest?.scope !== "list") return;
    const index = visibleIssueIds.indexOf(focusRequest.issueId);
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: "auto" });
    }
  }, [focusRequest, visibleIssueIds, virtualizer]);

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
      const nextIndex = visibleIssueIds.indexOf(previousAnchor.id);
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
    visibleIssueIds,
    virtualizer,
    virtualizer.getOffsetForIndex,
    virtualizer.scrollToOffset,
  ]);

  const fallbackCount = Math.min(sorted.length, FALLBACK_RENDER_COUNT);
  const renderedIndexes =
    virtualItems.length > 0
      ? virtualItems.map((item) => item.index)
      : Array.from({ length: fallbackCount }, (_, index) => index);
  const firstVirtualItem = virtualItems[0];
  const lastVirtualItem = virtualItems.at(-1);
  const totalSize =
    virtualizer.getTotalSize() ||
    ISSUE_TABLE_HEADER_HEIGHT + sorted.length * ISSUE_TABLE_ROW_HEIGHT;
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
    sorted.length > 0 ||
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
        <Table
          className="table-fixed"
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
      ) : initialLoadError ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          <p className="text-sm text-muted-foreground">{t("loadError")}</p>
          <button
            type="button"
            className="rounded-md border border-border bg-elevated px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover"
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
                className="rounded-md border border-border bg-elevated px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover"
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
          className="min-h-0 h-full min-w-0 flex-1 overflow-auto overscroll-contain"
          data-testid="issue-list-scroll-container"
        >
          <Table
            className="table-fixed"
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
                const issue = sorted[index];
                if (!issue) return null;
                return (
                  <IssueListRow
                    key={issue.id}
                    issue={issue}
                    vault={vault}
                    allIssues={graph}
                    planningCatalog={planningCatalog}
                    highlightQuery={searchQuery}
                    logicalIds={visibleIssueIds}
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
                        className="rounded-md border border-border bg-elevated px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover"
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
