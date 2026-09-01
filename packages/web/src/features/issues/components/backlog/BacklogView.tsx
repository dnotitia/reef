"use client";

import { SearchProgressBar } from "@/components/ui/SearchProgressBar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { notifyReorderFailure } from "@/components/ui/toastFeedback";
import { BacklogRow } from "@/features/issues/components/backlog/BacklogRow";
import { IssueSelectionCheckbox } from "@/features/issues/components/shared/IssueSelectionCheckbox";
import {
  IssueReorderAnnouncement,
  type IssueReorderSurfaceState,
} from "@/features/issues/components/shared/IssueReorderFeedback";
import {
  BACKLOG_COLUMNS,
  ISSUE_TABLE_COLUMN_WIDTHS,
  type IssueTableColumnKey,
  issueTableWidth,
} from "@/features/issues/components/shared/issueTableContract";
import { useReorderBacklog } from "@/features/issues/hooks/mutations/useReorderBacklog";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueRelations } from "@/features/issues/hooks/queries/useIssueRelations";
import { useResolvedAutoHideWindows } from "@/features/issues/hooks/useResolvedAutoHideWindows";
import { useOpenIssue } from "@/features/issues/hooks/view/useOpenIssue";
import {
  buildIssueQuery,
  buildManualIssueQuery,
} from "@/features/issues/lib/buildIssueQuery";
import {
  buildIssueReorderTargetFromDrop,
  type IssueReorderTarget,
} from "@/features/issues/lib/issueReorder";
import { applyDependencyFilter } from "@/features/issues/lib/dependencyUtils";
import { buildOpenIssueHref } from "@/features/issues/lib/issueHref";
import type { IssueGroupBy } from "@/features/issues/lib/groupBy";
import { createIssueGroupDescriptor } from "@/features/issues/lib/grouping";
import {
  filterIssues,
  searchIssues,
  sortIssues,
  sortIssuesByRankOrder,
} from "@/features/issues/lib/issueListUtils";
import { loadedSelectionState } from "@/features/issues/lib/issueSelection";
import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import {
  isManualOrdering,
  useIssueStore,
} from "@/features/issues/stores/useIssueStore";
import { PageBody } from "@/features/ui/components/PageBody";
import { useFieldNameLabels, usePriorityLabels } from "@/i18n/fieldLabels";
import { DURATION_BASE, EASE_SIGNATURE } from "@/lib/motionTokens";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import type { IssueListItem } from "@reef/core";
import { CircleDashed } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const EMPTY_ISSUES: IssueListItem[] = [];

const BACKLOG_COL_COUNT = BACKLOG_COLUMNS.length;
const BACKLOG_TABLE_WIDTH = issueTableWidth(BACKLOG_COLUMNS);

// The view IS the backlog status, so it is consistently pinned to `['backlog']`.
const BACKLOG_STATUS: readonly string[] = ["backlog"];

const REORDER_TOAST_ID = "backlog-reorder";

function backlogColumnClass(column: IssueTableColumnKey) {
  return cn(
    "h-10 min-w-0 px-3 py-0 align-middle",
    column === "title" && "min-w-[15rem]",
  );
}

function backlogColumnStyle(column: IssueTableColumnKey) {
  return column === "title"
    ? { minWidth: ISSUE_TABLE_COLUMN_WIDTHS.title }
    : { width: ISSUE_TABLE_COLUMN_WIDTHS[column] };
}

function BacklogColumnGroup() {
  return (
    <colgroup>
      {BACKLOG_COLUMNS.map((column) => (
        <col
          key={column}
          data-column-key={column}
          style={
            column === "title"
              ? { minWidth: ISSUE_TABLE_COLUMN_WIDTHS.title }
              : { width: ISSUE_TABLE_COLUMN_WIDTHS[column] }
          }
        />
      ))}
    </colgroup>
  );
}

interface BacklogViewProps {
  vault: string;
  groupBy?: IssueGroupBy;
}

/**
 * The dedicated backlog view: a flat triage list of `backlog` issues with an
 * inline quick-edit fields to triage them in place and
 * drag-to-reorder for the editable `rank` order (REEF-129). It owns its own
 * fetch and reorder mutation; field edits use the shared List quick-edit path.
 * The surrounding chrome (PageHeader, ViewSwitcher, filter toolbar) is owned
 * by IssuesWorkspace, which hides the status facet for this view.
 *
 * Rank order is the default (no explicit user sort): the server orders by
 * `rank`, the rows are drag-reorderable, and unranked issues sink to a tail
 * below a divider. Picking a sort from the toolbar switches to that sort and
 * disables reordering until rank order is restored.
 */
export function BacklogView({ vault, groupBy = "priority" }: BacklogViewProps) {
  const t = useTranslations("issues.backlog");
  const reorderT = useTranslations("issues.reorder");
  const groupT = useTranslations("issues.filters");
  const c = useTranslations("common");
  const toasts = useTranslations("toasts");
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  const openIssue = useOpenIssue();
  const searchParams = useSearchParams();
  const reorder = useReorderBacklog();
  const priorityLabels = usePriorityLabels();

  // Rank order is shown whenever the user has not picked an explicit sort.
  const isRankOrder = isManualOrdering(filter);

  // The effective backlog filter: force `status=['backlog']` on the server query
  // AND the client residual filter (overriding the store's hidden status facet),
  // and neutralize the facets the backlog bar hides — Sprint, Release, and Due.
  // Those three are meaningless or contradictory in the backlog (a committed item
  // does not be here; the view drops the Due column), so the bar drops their
  // triggers (REEF-177); stripping their stored values here means a value toggled
  // in list/board and carried over in the shared filter store does not silently
  // narrow the backlog. Forcing status client-side too means an optimistic
  // promotion (backlog -> Todo) drops the row from this list at once, FLIPing it
  // out before the refetch lands.
  const backlogFilter = useMemo(
    () => ({
      ...filter,
      status: BACKLOG_STATUS as string[],
      sprint_id: undefined,
      release_id: undefined,
      due: undefined,
      showStale: undefined,
    }),
    [filter],
  );

  // Whether any KEPT triage facet or search narrows the backlog to a subset.
  // Derived from `backlogFilter` so the neutralized sprint/release/due facets
  // does not count (they are neither shown nor applied) — matching the bar's reduced
  // facet set (REEF-177). Drives the no-matches-vs-empty signal below; it does
  // NOT gate drag-reorder: in rank order the query fetches the full ranked
  // backlog (the ordering spine), so a filtered reorder is computed against the
  // true global neighbors — see `query` and `orderedBacklog` (REEF-176).
  const filtersActive = !!(
    backlogFilter.issueType?.length ||
    backlogFilter.priority?.length ||
    backlogFilter.priorityUnset ||
    backlogFilter.assignee ||
    backlogFilter.assigneeUnset ||
    backlogFilter.requester ||
    backlogFilter.milestone_id ||
    backlogFilter.severity?.length ||
    backlogFilter.severityUnset ||
    backlogFilter.label ||
    backlogFilter.dependencyFilter?.length ||
    searchQuery
  );

  // FLIP rows out when a status change drops them from the backlog. Disabled
  // while reordering is live so it does not fight the sortable drag transforms;
  // reordering animates through dnd-kit instead. Honors prefers-reduced-motion.
  const [rowsRef] = useAutoAnimate<HTMLTableSectionElement>({
    duration: DURATION_BASE,
    easing: EASE_SIGNATURE,
  });

  const sensors = useSensors(
    // A short distance separates a click (open the issue) from a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const query = useMemo(() => {
    // Rank order fetches the FULL ranked backlog as an ordering spine: the
    // triage facets and search are NOT sent to the server (they are applied
    // client-side for display below), so a drag-reorder while filtered computes
    // against the true global neighbors instead of the visible subset —
    // otherwise the moved row's rank could collide with or cross a hidden ranked
    // row (REEF-176). `showArchived` is kept, NOT dropped: it gates which rows the
    // server fetches (archived rows are excluded unless asked for), so the client
    // pipeline could not restore them — unlike a triage facet, which just narrows
    // an already-fetched set. `rank` ascending puts any unranked rows in the tail;
    // it is does not a user-pickable sort. With an explicit user sort, reordering is
    // off, so the normal server-filtered query applies.
    if (isRankOrder) {
      return buildManualIssueQuery(filter, "backlog");
    }
    return buildIssueQuery(backlogFilter, searchQuery);
  }, [isRankOrder, backlogFilter, filter, searchQuery]);
  const {
    data: issues,
    isPending,
    isFetching,
    isError,
    isPlaceholderData,
    refetch,
  } = useIssueList(vault, query);
  const staleWindowDays = useResolvedAutoHideWindows(vault);
  const { data: relations } = useIssueRelations(vault);

  // Reorder on the FRESH active backlog, does not while a previous reorder is still
  // in flight. A triage filter no longer blocks it (REEF-176): the rank-order
  // query loads the full ranked backlog, so a filtered drag is computed against
  // the true global neighbors. Sort/filter transitions serve stale placeholder
  // rows; a second overlapping drag would POST absolute ranks that, under akb's
  // last-write-wins, can arrive out of order. `showArchived` surfaces archived
  // rows that should not join rank order (the server skips them too). All
  // remaining windows are guarded here.
  const canReorder =
    isRankOrder &&
    !filter.showArchived &&
    !isPlaceholderData &&
    !isFetching &&
    !reorder.isPending;
  const reorderIssueId =
    reorder.variables?.vault === vault && reorder.variables.scope === "backlog"
      ? reorder.variables.issueId
      : null;
  const reorderState: IssueReorderSurfaceState | null = reorder.isPending
    ? "pending"
    : reorder.isError
      ? "error"
      : null;
  const [reorderAnnouncement, setReorderAnnouncement] = useState<string>("");

  const allIssues = issues ?? EMPTY_ISSUES;
  const graph = relations ?? allIssues;

  // The full active backlog in rank order — the spine a drag-reorder computes
  // against (not the filtered visible rows), so a filtered drop lands between the
  // moved row's true global neighbors (REEF-176). In rank order `allIssues` is
  // the unfiltered ranked backlog; the status/archived pin guards a stale
  // optimistically-promoted row. In sorted mode reordering is off, so unused.
  const orderedBacklog = useMemo(
    () =>
      sortIssuesByRankOrder(
        allIssues.filter(
          (i) => i.status === "backlog" && i.archived_at == null,
        ),
      ),
    [allIssues],
  );

  const visibleIssues = useMemo(() => {
    const filtered = filterIssues(allIssues, backlogFilter, {
      searchActive: searchQuery.trim().length > 0,
      staleWindowDays,
    });
    const searched = searchIssues(filtered, searchQuery);
    const depFiltered = applyDependencyFilter(
      searched,
      filter.dependencyFilter ?? null,
      graph,
    );
    return isRankOrder
      ? sortIssuesByRankOrder(depFiltered)
      : sortIssues(depFiltered, filter.sortField, filter.sortOrder);
  }, [
    allIssues,
    backlogFilter,
    graph,
    searchQuery,
    filter,
    isRankOrder,
    staleWindowDays,
  ]);

  const priorityGroups = useMemo(() => {
    if (groupBy !== "priority") return null;
    const descriptor = createIssueGroupDescriptor("priority", {
      labels: {
        none: groupT("group.none"),
        status: {},
        priority: priorityLabels,
      },
    });
    return descriptor
      .bucketsForIssues(visibleIssues)
      .filter(({ issues: bucketIssues }) => bucketIssues.length > 0);
  }, [groupBy, groupT, priorityLabels, visibleIssues]);

  // The divider sits between the manually-ordered (ranked) rows and the unranked
  // tail. Hidden when the backlog is entirely ranked or entirely unranked.
  const firstUnrankedIndex = useMemo(
    () => (isRankOrder ? visibleIssues.findIndex((i) => i.rank == null) : -1),
    [isRankOrder, visibleIssues],
  );
  const showDivider =
    firstUnrankedIndex > 0 && firstUnrankedIndex < visibleIssues.length;

  const sortableIds = useMemo(
    () => visibleIssues.map((i) => i.id),
    [visibleIssues],
  );

  useEffect(() => {
    useIssueKeyboardStore.getState().setVisibleIssueIds("backlog", sortableIds);
  }, [sortableIds]);

  useEffect(() => {
    return () => {
      useIssueKeyboardStore.getState().setVisibleIssueIds("backlog", []);
    };
  }, []);

  function runReorder(input: IssueReorderTarget) {
    setReorderAnnouncement(reorderT("reorderSaving", { id: input.issueId }));
    useIssueKeyboardStore.getState().focusIssue("backlog", input.issueId, {
      requestDomFocus: true,
    });
    reorder.mutateAsync({ vault, scope: "backlog", ...input }).then(
      () => {
        toast.dismiss(REORDER_TOAST_ID);
        setReorderAnnouncement(reorderT("reorderSaved", { id: input.issueId }));
      },
      (err: unknown) => {
        setReorderAnnouncement(
          reorderT("reorderFailed", { id: input.issueId }),
        );
        notifyReorderFailure(
          err,
          {
            id: REORDER_TOAST_ID,
            title: t("reorderErrorTitle"),
            description: t("reorderErrorDescription"),
            labels: { retry: c("retry"), retrying: toasts("retrying") },
            onRetry: () => runReorder(input),
          },
          {
            title: t("reorderConflictTitle"),
            description: t("reorderConflictDescription"),
          },
        );
      },
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    // Rows are non-draggable unless `canReorder`. The reorder is computed against
    // `orderedBacklog` (the full ranked backlog), not the filtered visible rows,
    // so a drop under an active filter lands between the moved row's true global
    // neighbors — no collision with or crossing of hidden ranked rows (REEF-176).
    if (!canReorder) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const target = buildIssueReorderTargetFromDrop(
      orderedBacklog,
      String(active.id),
      String(over.id),
    );
    if (!target) return;
    runReorder(target);
  }

  const announcements = useMemo<Announcements>(() => {
    const positionOf = (id: string | undefined) => {
      if (!id) return null;
      const index = orderedBacklog.findIndex((issue) => issue.id === id);
      return index < 0 ? null : index + 1;
    };
    return {
      onDragStart: ({ active }) => t("dragStart", { id: String(active.id) }),
      onDragOver: ({ active, over }) => {
        const position = positionOf(over ? String(over.id) : undefined);
        return position === null
          ? undefined
          : t("dragOver", { id: String(active.id), position });
      },
      onDragEnd: ({ active, over }) => {
        const position = positionOf(over ? String(over.id) : undefined);
        return position === null
          ? undefined
          : t("dragEnd", { id: String(active.id), position });
      },
      onDragCancel: ({ active }) => t("dragCancel", { id: String(active.id) }),
    };
  }, [orderedBacklog, t]);

  const issueHref = useCallback(
    (id: string) => buildOpenIssueHref(vault, id, searchParams),
    [searchParams, vault],
  );

  const count = visibleIssues.length;
  // `filtersActive` (computed above) doubles as the no-matches signal: a zero
  // count with filters active means "filtered to nothing", not an empty backlog
  // — mirror the list/timeline no-matches state instead (REEF-109).

  const reorderHint = !isRankOrder
    ? t("reorderHintSwitchToRank")
    : canReorder
      ? t("reorderHintDrag")
      : filter.showArchived
        ? t("reorderHintHideArchived")
        : // Transient (placeholder / in-flight reorder): keep the affordance.
          t("reorderHintDrag");

  return (
    <PageBody
      pad="compact"
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <IssueReorderAnnouncement message={reorderAnnouncement} />
      {/* Refetch hairline pinned to the list's top edge. The skeleton owns the
          first-load signal; this appears during refetches (REEF-369). */}
      <div className="pointer-events-none sticky top-0 z-10 h-0 overflow-visible">
        <SearchProgressBar
          active={isFetching && !isPending}
          className="top-0 bottom-auto"
        />
      </div>
      {isPending ? (
        <div
          className="min-h-0 flex-1 overflow-hidden"
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
            data-testid="backlog-scroll-container"
          >
            <Table
              className="table-fixed"
              data-testid="backlog-table"
              style={{ minWidth: BACKLOG_TABLE_WIDTH }}
              containerClassName="overflow-visible"
            >
              <BacklogColumnGroup />
              <BacklogTableHeader
                reorderHint={reorderHint}
                visibleIssueIds={[]}
                disabled
              />
              <TableBody>
                <BacklogSkeleton />
              </TableBody>
            </Table>
          </div>
        </div>
      ) : isError ? (
        <div
          className="flex flex-col items-center justify-center gap-3 py-12"
          role="alert"
          aria-live="assertive"
        >
          <p className="text-sm text-muted-foreground">{t("loadError")}</p>
          <button
            type="button"
            className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 type-caption font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover"
            onClick={() => refetch()}
          >
            {c("retry")}
          </button>
        </div>
      ) : count === 0 ? (
        filtersActive ? (
          <BacklogNoMatches />
        ) : (
          <BacklogEmptyState vault={vault} />
        )
      ) : (
        <div
          className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus/30"
          role="region"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The labeled overflow region is the keyboard scrollport.
          tabIndex={0}
          aria-label={t("scrollRegion")}
          data-testid="backlog-scroll-container"
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            accessibility={{ announcements }}
            onDragEnd={handleDragEnd}
            onDragCancel={(event) => {
              useIssueKeyboardStore
                .getState()
                .focusIssue("backlog", String(event.active.id), {
                  requestDomFocus: true,
                });
            }}
          >
            <Table
              className="table-fixed"
              data-testid="backlog-table"
              style={{ minWidth: BACKLOG_TABLE_WIDTH }}
              containerClassName="overflow-visible"
            >
              <BacklogColumnGroup />
              <BacklogTableHeader
                reorderHint={reorderHint}
                visibleIssueIds={sortableIds}
              />
              <TableBody ref={canReorder ? undefined : rowsRef}>
                <SortableContext
                  items={sortableIds}
                  strategy={verticalListSortingStrategy}
                >
                  {priorityGroups
                    ? priorityGroups.map(({ bucket, issues: bucketIssues }) => (
                        <Fragment key={bucket.id}>
                          <BacklogGroupHeader
                            bucketId={bucket.id}
                            label={bucket.label}
                            count={bucketIssues.length}
                          />
                          {bucketIssues.map((issue, index) => (
                            <Fragment key={issue.id}>
                              {isRankOrder &&
                              bucketIssues.some((item) => item.rank != null) &&
                              index ===
                                bucketIssues.findIndex(
                                  (item) => item.rank == null,
                                ) ? (
                                <BacklogUnrankedDivider />
                              ) : null}
                              <BacklogRow
                                issue={issue}
                                vault={vault}
                                href={issueHref(issue.id)}
                                logicalIds={sortableIds}
                                sortable={canReorder}
                                reorderHint={reorderHint}
                                reorderState={
                                  reorderIssueId === issue.id
                                    ? reorderState
                                    : null
                                }
                                onOpen={openIssue}
                              />
                            </Fragment>
                          ))}
                        </Fragment>
                      ))
                    : visibleIssues.map((issue, index) => (
                        <Fragment key={issue.id}>
                          {showDivider && index === firstUnrankedIndex && (
                            <BacklogUnrankedDivider />
                          )}
                          <BacklogRow
                            issue={issue}
                            vault={vault}
                            href={issueHref(issue.id)}
                            logicalIds={sortableIds}
                            sortable={canReorder}
                            reorderHint={reorderHint}
                            reorderState={
                              reorderIssueId === issue.id ? reorderState : null
                            }
                            onOpen={openIssue}
                          />
                        </Fragment>
                      ))}
                </SortableContext>
              </TableBody>
            </Table>
          </DndContext>
        </div>
      )}
    </PageBody>
  );
}

function BacklogTableHeader({
  reorderHint,
  visibleIssueIds,
  disabled = false,
}: {
  reorderHint: string;
  visibleIssueIds: readonly string[];
  disabled?: boolean;
}) {
  const columnLabels = useFieldNameLabels();
  const t = useTranslations("issues.backlog");
  const bulk = useTranslations("issues.bulk");
  const selectedIds = useIssueSelectionStore((state) => state.selectedIds);
  const selectionRunning = useIssueSelectionStore((state) => state.running);
  const selectAllState = loadedSelectionState(selectedIds, visibleIssueIds);
  return (
    <TableHeader>
      <TableRow className="h-8">
        {BACKLOG_COLUMNS.map((column) => (
          <TableHead
            key={column}
            className="h-8 px-3 py-0"
            style={
              column === "title"
                ? { minWidth: ISSUE_TABLE_COLUMN_WIDTHS.title }
                : { width: ISSUE_TABLE_COLUMN_WIDTHS[column] }
            }
            data-column-key={column}
            data-testid={column === "rank" ? "backlog-rank-header" : undefined}
            aria-describedby={
              column === "rank" ? "backlog-rank-description" : undefined
            }
            title={column === "rank" ? reorderHint : undefined}
          >
            {column === "select" ? (
              <IssueSelectionCheckbox
                checked={selectAllState === "checked"}
                indeterminate={selectAllState === "mixed"}
                disabled={disabled || selectionRunning}
                label={bulk("selectAllLoaded")}
                testId="backlog-select-all"
                onChange={() =>
                  useIssueSelectionStore
                    .getState()
                    .toggleAllLoaded(visibleIssueIds)
                }
              />
            ) : column === "rank" ? (
              <>
                <span className="sr-only">{t("rank")}</span>
                <span id="backlog-rank-description" className="sr-only">
                  {reorderHint}
                </span>
              </>
            ) : (
              columnLabels[column]
            )}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

function BacklogGroupHeader({
  bucketId,
  label,
  count,
}: {
  bucketId: string;
  label: string;
  count: number;
}) {
  const t = useTranslations("issues.list");
  return (
    <TableRow data-testid="backlog-group-header" data-group-id={bucketId}>
      <TableCell
        colSpan={BACKLOG_COL_COUNT}
        className="h-8 border-y border-border-subtle p-0"
      >
        <div className="flex h-8 items-center gap-2 bg-surface-page px-3 type-group-title text-foreground">
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="type-mono-value text-muted-foreground">
            {t("groupHeader", { label, count })}
          </span>
        </div>
      </TableCell>
    </TableRow>
  );
}

// The boundary between the manually-ordered rows and the unranked tail. A quiet
// affordance: it appears once at least one row has been manually ordered.
function BacklogUnrankedDivider() {
  const t = useTranslations("issues.backlog");
  return (
    <tr data-testid="backlog-unranked-divider">
      <td colSpan={BACKLOG_COL_COUNT} className="px-3 py-1">
        <div className="flex items-center gap-2 type-section-label text-muted-foreground">
          <span className="h-px flex-1 bg-border-subtle" />
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <CircleDashed className="h-3 w-3" aria-hidden="true" />
            {t("unrankedDivider")}
          </span>
          <span className="h-px flex-1 bg-border-subtle" />
        </div>
      </td>
    </tr>
  );
}

// Zero results because the triage filters/search hid the backlog — distinct from
// a genuinely empty backlog, matching the list/timeline no-matches affordance.
function BacklogNoMatches() {
  const t = useTranslations("issues.backlog");
  const c = useTranslations("common");
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-12"
      data-testid="backlog-no-matches"
    >
      <p className="text-sm text-muted-foreground">{t("noMatches")}</p>
      <button
        type="button"
        className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 type-caption font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover"
        onClick={() => useIssueStore.getState().clearFilter()}
      >
        {c("clearFilters")}
      </button>
    </div>
  );
}

const SKELETON_ROW_KEYS = Array.from(
  { length: 6 },
  (_, i) => `backlog-skel-${i}`,
);

function BacklogSkeleton() {
  return (
    <>
      {SKELETON_ROW_KEYS.map((rowKey) => (
        <TableRow
          key={rowKey}
          className="h-10"
          data-testid="backlog-skeleton-row"
        >
          {BACKLOG_COLUMNS.map((column) => (
            <TableCell
              key={column}
              className={backlogColumnClass(column)}
              style={backlogColumnStyle(column)}
              data-column-key={column}
            >
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function BacklogEmptyState({ vault }: { vault: string }) {
  const t = useTranslations("issues.backlog");
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-16 text-center"
      data-testid="backlog-empty"
    >
      <CircleDashed
        className="h-10 w-10 text-muted-foreground/50"
        strokeWidth={1.25}
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("emptyDescription")}</p>
      </div>
      <Link
        href={withVault(vault, "/issues?scope=active&view=board")}
        className="type-caption font-medium text-brand-text hover:underline"
      >
        {t("goToBoard")}
      </Link>
    </div>
  );
}
