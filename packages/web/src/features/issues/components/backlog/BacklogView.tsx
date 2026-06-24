"use client";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  kanbanToastId,
  notifyRetryableError,
} from "@/components/ui/toastFeedback";
import { BacklogRow } from "@/features/issues/components/backlog/BacklogRow";
import { CloseIssueDialog } from "@/features/issues/components/detail/CloseIssueDialog";
import { useReorderBacklog } from "@/features/issues/hooks/mutations/useReorderBacklog";
import { useUpdateIssue } from "@/features/issues/hooks/mutations/useUpdateIssue";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueRelations } from "@/features/issues/hooks/queries/useIssueRelations";
import { useResolvedAutoHideWindows } from "@/features/issues/hooks/useResolvedAutoHideWindows";
import { useOpenIssue } from "@/features/issues/hooks/view/useOpenIssue";
import { buildIssueQuery } from "@/features/issues/lib/buildIssueQuery";
import { applyDependencyFilter } from "@/features/issues/lib/dependencyUtils";
import {
  filterIssues,
  searchIssues,
  sortIssues,
} from "@/features/issues/lib/issueListUtils";
import { buildStatusPatch } from "@/features/issues/lib/statusPatch";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { PageBody } from "@/features/ui/components/PageBody";
import { useFieldNameLabels } from "@/i18n/fieldLabels";
import { DURATION_BASE, EASE_SIGNATURE } from "@/lib/motionTokens";
import {
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
import {
  type ClosedReason,
  type IssueListItem,
  type Status,
  backlogRankSortKey,
} from "@reef/core";
import type { FieldNameKey } from "@reef/core/fields";
import { CircleDashed } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";

const EMPTY_ISSUES: IssueListItem[] = [];

// Slim triage column set — board/list planning columns (sprint/milestone/
// release/start/due) are noise here (REEF-109). A leading grip column carries
// the drag handle in manual-order mode (REEF-129). These are field-name keys;
// the header text is locale-resolved at render from the shared `fieldNames`
// catalog (REEF-298), and each entry is checked against `FieldNameKey`.
const BACKLOG_COLUMNS = [
  "type",
  "id",
  "title",
  "status",
  "priority",
  "assignee",
  "updated",
] as const satisfies readonly FieldNameKey[];

// Grip + the visible columns; the divider row spans all of them.
const BACKLOG_COL_COUNT = BACKLOG_COLUMNS.length + 1;

// The view IS the backlog status, so it is consistently pinned to `['backlog']`.
const BACKLOG_STATUS: readonly string[] = ["backlog"];

const REORDER_TOAST_ID = "backlog-reorder";

// Manual backlog order is a pure function of (rank, created_at, id): ranked rows
// ascending by rank, then any unranked rows newest-first. The created_at tie
// break is explicit rather than leaning on the server's lexical `reef_id DESC`,
// which mis-orders ids past the 3-digit padding boundary (REEF-1000 before
// REEF-999); the unique id break keeps it deterministic.
function compareBacklogManualOrder(a: IssueListItem, b: IssueListItem): number {
  const byRank = backlogRankSortKey(a.rank) - backlogRankSortKey(b.rank);
  if (byRank !== 0) return byRank;
  if (a.created_at !== b.created_at)
    return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

interface BacklogViewProps {
  vault: string;
}

/**
 * The dedicated backlog view: a flat triage list of `backlog` issues with an
 * inline status picker to promote them out of the backlog (REEF-109) and
 * drag-to-reorder for the manual `rank` order (REEF-129). It owns its own fetch
 * and the status/reorder mutations; the surrounding chrome (PageHeader,
 * ViewSwitcher, filter toolbar) is owned by IssuesWorkspace, which hides the
 * status facet for this view.
 *
 * Manual order is the default (no explicit user sort): the server orders by
 * `rank`, the rows are drag-reorderable, and unranked issues sink to a tail
 * below a divider. Picking a sort from the toolbar switches to that sort and
 * disables reordering until manual order is restored.
 */
export function BacklogView({ vault }: BacklogViewProps) {
  const t = useTranslations("issues.backlog");
  const c = useTranslations("common");
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  const openIssue = useOpenIssue();
  const mutation = useUpdateIssue();
  const reorder = useReorderBacklog();
  const [pendingCloseIssue, setPendingCloseIssue] =
    useState<IssueListItem | null>(null);

  // Rank order is shown whenever the user has not picked an explicit sort.
  const isManualOrder = !filter.sortField;

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
    }),
    [filter],
  );

  // Whether any KEPT triage facet or search narrows the backlog to a subset.
  // Derived from `backlogFilter` so the neutralized sprint/release/due facets
  // does not count (they are neither shown nor applied) — matching the bar's reduced
  // facet set (REEF-177). Drives the no-matches-vs-empty signal below; it does
  // NOT gate drag-reorder: in manual order the query fetches the full ranked
  // backlog (the ordering spine), so a filtered reorder is computed against the
  // true global neighbors — see `query` and `orderedBacklog` (REEF-176).
  const filtersActive = !!(
    backlogFilter.issueType?.length ||
    backlogFilter.priority?.length ||
    backlogFilter.assignee ||
    backlogFilter.requester ||
    backlogFilter.milestone_id ||
    backlogFilter.severity?.length ||
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
    // Manual order fetches the FULL ranked backlog as an ordering spine: the
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
    if (isManualOrder) {
      return {
        ...buildIssueQuery(
          {
            status: BACKLOG_STATUS as string[],
            showArchived: filter.showArchived,
          },
          "",
        ),
        sort_field: "rank",
        sort_order: "asc",
      };
    }
    return buildIssueQuery(backlogFilter, searchQuery);
  }, [isManualOrder, backlogFilter, searchQuery, filter.showArchived]);
  const {
    data: issues,
    isPending,
    isError,
    isPlaceholderData,
    refetch,
  } = useIssueList(vault, query);
  const staleWindowDays = useResolvedAutoHideWindows(vault);
  const { data: relations } = useIssueRelations(vault);

  // Reorder on the FRESH active backlog, does not while a previous reorder is still
  // in flight. A triage filter no longer blocks it (REEF-176): the manual-order
  // query loads the full ranked backlog, so a filtered drag is computed against
  // the true global neighbors. Sort/filter transitions serve stale placeholder
  // rows; a second overlapping drag would POST absolute ranks that, under akb's
  // last-write-wins, can arrive out of order. `showArchived` surfaces archived
  // rows that should not join the manual order (the server skips them too). All
  // remaining windows are guarded here.
  const canReorder =
    isManualOrder &&
    !filter.showArchived &&
    !isPlaceholderData &&
    !reorder.isPending;

  const allIssues = issues ?? EMPTY_ISSUES;
  const graph = relations ?? allIssues;

  // The full active backlog in manual order — the spine a drag-reorder computes
  // against (not the filtered visible rows), so a filtered drop lands between the
  // moved row's true global neighbors (REEF-176). In manual order `allIssues` is
  // the unfiltered ranked backlog; the status/archived pin guards a stale
  // optimistically-promoted row. In sorted mode reordering is off, so unused.
  const orderedBacklog = useMemo(
    () =>
      allIssues
        .filter((i) => i.status === "backlog" && i.archived_at == null)
        .sort(compareBacklogManualOrder),
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
    return isManualOrder
      ? [...depFiltered].sort(compareBacklogManualOrder)
      : sortIssues(depFiltered, filter.sortField, filter.sortOrder);
  }, [
    allIssues,
    backlogFilter,
    graph,
    searchQuery,
    filter,
    isManualOrder,
    staleWindowDays,
  ]);

  // The divider sits between the manually-ordered (ranked) rows and the unranked
  // tail. Hidden when the backlog is entirely ranked or entirely unranked.
  const firstUnrankedIndex = useMemo(
    () => (isManualOrder ? visibleIssues.findIndex((i) => i.rank == null) : -1),
    [isManualOrder, visibleIssues],
  );
  const showDivider =
    firstUnrankedIndex > 0 && firstUnrankedIndex < visibleIssues.length;

  const sortableIds = useMemo(
    () => visibleIssues.map((i) => i.id),
    [visibleIssues],
  );

  function runStatusUpdate(input: {
    id: string;
    patch: ReturnType<typeof buildStatusPatch>;
  }) {
    mutation.mutateAsync({ id: input.id, vault, patch: input.patch }).then(
      () => toast.dismiss(kanbanToastId(input.id)),
      (err: unknown) => {
        notifyRetryableError({
          id: kanbanToastId(input.id),
          title:
            err instanceof Error && err.message
              ? err.message
              : t("updateErrorTitle"),
          description: t("updateErrorDescription"),
          onRetry: () => runStatusUpdate(input),
        });
      },
    );
  }

  function runReorder(input: {
    ordered: IssueListItem[];
    fromIndex: number;
    toIndex: number;
  }) {
    reorder.mutateAsync({ vault, ...input }).then(
      () => toast.dismiss(REORDER_TOAST_ID),
      (err: unknown) => {
        notifyRetryableError({
          id: REORDER_TOAST_ID,
          title:
            err instanceof Error && err.message
              ? err.message
              : t("reorderErrorTitle"),
          description: t("reorderErrorDescription"),
          onRetry: () => runReorder(input),
        });
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
    const fromIndex = orderedBacklog.findIndex((i) => i.id === active.id);
    const toIndex = orderedBacklog.findIndex((i) => i.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    runReorder({ ordered: orderedBacklog, fromIndex, toIndex });
  }

  function handleStatusChange(issue: IssueListItem, nextStatus: Status) {
    if (nextStatus === issue.status) return;
    // Closing needs a reason — route through the shared dialog like the board.
    if (nextStatus === "closed") {
      setPendingCloseIssue(issue);
      return;
    }
    runStatusUpdate({
      id: issue.id,
      patch: buildStatusPatch(issue, nextStatus),
    });
  }

  function confirmClose(reason: ClosedReason) {
    if (!pendingCloseIssue) return;
    const issue = pendingCloseIssue;
    setPendingCloseIssue(null);
    runStatusUpdate({
      id: issue.id,
      patch: buildStatusPatch(issue, "closed", undefined, reason),
    });
  }

  const count = visibleIssues.length;
  // `filtersActive` (computed above) doubles as the no-matches signal: a zero
  // count with filters active means "filtered to nothing", not an empty backlog
  // — mirror the list/timeline no-matches state instead (REEF-109).

  // The backlog body carries the reorder *affordance* — why drag is on or
  // off and how to enable it. The result count and the view's identity live in
  // the shared chrome (the ViewSwitcher tab), so the body stays free of the
  // count/identity row the other views don't have (REEF-175). This is does not a
  // second sort label either: the header SortControl owns the order vocabulary,
  // including the word "Manual order" (REEF-169).
  const reorderHint = !isManualOrder
    ? t("reorderHintSwitchToManual")
    : canReorder
      ? t("reorderHintDrag")
      : filter.showArchived
        ? t("reorderHintHideArchived")
        : // Transient (placeholder / in-flight reorder): keep the affordance.
          t("reorderHintDrag");

  return (
    <PageBody pad="compact">
      {/* Shown when rows are on screen — gated on having rows, not on a
          (now-removed) count display, so loading/empty/error states does not carry
          an orphan affordance row. */}
      {count > 0 ? (
        <div
          className="mb-2 flex items-center justify-end px-1 text-xs font-medium text-muted-foreground"
          data-testid="backlog-header"
        >
          <span data-testid="backlog-order-mode">{reorderHint}</span>
        </div>
      ) : null}

      {isPending ? (
        <Table>
          <BacklogTableHeader />
          <TableBody>
            <BacklogSkeleton />
          </TableBody>
        </Table>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          <p className="text-sm text-muted-foreground">{t("loadError")}</p>
          <button
            type="button"
            className="rounded-md border border-border bg-elevated px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover"
            onClick={() => refetch()}
          >
            {c("retry")}
          </button>
        </div>
      ) : count === 0 ? (
        filtersActive ? (
          <BacklogNoMatches />
        ) : (
          <BacklogEmptyState />
        )
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <Table>
            <BacklogTableHeader />
            <TableBody ref={canReorder ? undefined : rowsRef}>
              <SortableContext
                items={sortableIds}
                strategy={verticalListSortingStrategy}
              >
                {visibleIssues.map((issue, index) => (
                  <Fragment key={issue.id}>
                    {showDivider && index === firstUnrankedIndex && (
                      <BacklogUnrankedDivider />
                    )}
                    <BacklogRow
                      issue={issue}
                      sortable={canReorder}
                      onOpen={openIssue}
                      onStatusChange={handleStatusChange}
                    />
                  </Fragment>
                ))}
              </SortableContext>
            </TableBody>
          </Table>
        </DndContext>
      )}

      <CloseIssueDialog
        open={pendingCloseIssue !== null}
        issueId={pendingCloseIssue?.id ?? ""}
        disabled={mutation.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingCloseIssue(null);
        }}
        onConfirm={confirmClose}
      />
    </PageBody>
  );
}

function BacklogTableHeader() {
  const columnLabels = useFieldNameLabels();
  return (
    <TableHeader>
      <TableRow>
        {/* Grip column. */}
        <TableHead className="w-7" />
        {BACKLOG_COLUMNS.map((key) => (
          <TableHead key={key}>{columnLabels[key]}</TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

// The boundary between the manually-ordered rows and the unranked tail. A quiet
// affordance: it appears once at least one row has been manually ordered.
function BacklogUnrankedDivider() {
  const t = useTranslations("issues.backlog");
  return (
    <tr data-testid="backlog-unranked-divider">
      <td colSpan={BACKLOG_COL_COUNT} className="px-3 py-1">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
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
        className="rounded-md border border-border bg-elevated px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover"
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
        <TableRow key={rowKey} data-testid="backlog-skeleton-row">
          <TableCell className="w-7" />
          {BACKLOG_COLUMNS.map((col) => (
            <TableCell key={col}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function BacklogEmptyState() {
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
        href="/issues?view=board"
        className="text-[13px] font-medium text-brand hover:underline"
      >
        {t("goToBoard")}
      </Link>
    </div>
  );
}
