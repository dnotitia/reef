"use client";

import { BoardColumnsSkeleton } from "@/components/BoardColumnsSkeleton";
import { Button } from "@/components/ui/button";
import {
  kanbanToastId,
  notifyRetryableError,
} from "@/components/ui/toastFeedback";
import { CloseIssueDialog } from "@/features/issues/components/detail/CloseIssueDialog";
import { useReorderBacklog } from "@/features/issues/hooks/mutations/useReorderBacklog";
import { useUpdateIssue } from "@/features/issues/hooks/mutations/useUpdateIssue";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueRelations } from "@/features/issues/hooks/queries/useIssueRelations";
import { useResolvedAutoHideWindows } from "@/features/issues/hooks/useResolvedAutoHideWindows";
import { useOpenIssue } from "@/features/issues/hooks/view/useOpenIssue";
import { useWorkflowStatusGuard } from "@/features/issues/hooks/view/useWorkflowStatusGuard";
import { buildIssueQuery } from "@/features/issues/lib/buildIssueQuery";
import {
  buildBulkIssuePatch,
  type BulkIssueOperation,
} from "@/features/issues/lib/bulkIssueUpdate";
import {
  applyDependencyFilter,
  computeBlockedIds,
} from "@/features/issues/lib/dependencyUtils";
import {
  filterIssues,
  searchIssues,
  sortIssues,
  sortIssuesByRankOrder,
} from "@/features/issues/lib/issueListUtils";
import {
  filterForIssueScope,
  hasScopeFilters,
} from "@/features/issues/lib/scopeFilter";
import {
  createIssueGroupDescriptor,
  type IssueGroup,
  type IssueGroupBucket,
} from "@/features/issues/lib/grouping";
import type { IssueGroupBy } from "@/features/issues/lib/groupBy";
import type { IssueScope } from "@/features/issues/lib/viewMode";
import { useFlashStore } from "@/features/issues/stores/useFlashStore";
import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { usePlanningCatalog } from "@/features/planning/hooks/usePlanningCatalog";
import { useUserSearch } from "@/features/issues/hooks/queries/useUserSearch";
import { DURATION_BASE, EASE_SIGNATURE } from "@/lib/motionTokens";
import {
  DndContext,
  type Announcements,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  type DropAnimation,
  PointerSensor,
  KeyboardSensor,
  defaultDropAnimationSideEffects,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type {
  ClosedReason,
  IssueListItem,
  IssueUpdatePatch,
  Priority,
  Status,
} from "@reef/core";
import { usePriorityLabels, useStatusLabels } from "@/i18n/fieldLabels";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { withVault } from "@/lib/workspaceHref";
import { useBoardStore } from "../stores/useBoardStore";
import { KanbanCardPreview } from "./KanbanCard";
import { KanbanColumn } from "./KanbanColumn";

const EMPTY_ISSUES: IssueListItem[] = [];

function handleBoardScrollKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  event.currentTarget.scrollBy({
    left:
      event.key === "ArrowRight"
        ? event.currentTarget.clientWidth
        : -event.currentTarget.clientWidth,
    behavior: "smooth",
  });
}

// Drop settle — the drag overlay eases into the card's resting slot on the
// signature curve instead of snapping away (REEF-121). dnd-kit measures the
// active card's post-drop DOM position, so after a status change the overlay
// settles onto the card's new column (the optimistic update has already
// placed it there).
const DROP_ANIMATION: DropAnimation = {
  duration: DURATION_BASE,
  easing: EASE_SIGNATURE,
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: "0.4" } },
  }),
};

interface KanbanBoardProps {
  vault: string;
  scope?: IssueScope;
  groupBy?: IssueGroupBy;
}

/**
 * Issues grouped into 5 columns by status with drag-and-drop via
 * @dnd-kit/core. User-driven board edits allow moving an issue to any valid
 * status column, matching the issue detail status picker.
 */
export function KanbanBoard({
  vault,
  scope = "active",
  groupBy,
}: KanbanBoardProps) {
  const effectiveGroupBy =
    groupBy ?? (scope === "backlog" ? "priority" : "status");
  useWorkflowStatusGuard(scope === "active");
  const t = useTranslations("board");
  const backlogT = useTranslations("issues.backlog");
  const common = useTranslations("common");
  const toasts = useTranslations("toasts");
  const statusLabels = useStatusLabels();
  const priorityLabels = usePriorityLabels();
  const noMatchId = useId();
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  const scopedFilter = useMemo(
    () => filterForIssueScope(filter, scope),
    [filter, scope],
  );
  // Server-side narrows the transfer (facets + free-text search); the client
  // pipeline below still applies due/label/dependency residuals and grouping.
  // The whole-vault relation projection backs blocker badges + the dependency
  // filter so they stay correct over the server-filtered subset.
  const query = useMemo(() => {
    if (scope === "backlog" && !filter.sortField) {
      return {
        ...buildIssueQuery(
          { status: ["backlog"], showArchived: filter.showArchived },
          "",
          "backlog",
        ),
        sort_field: "rank",
        sort_order: "asc",
      };
    }
    const next = buildIssueQuery(filter, searchQuery, scope);
    return filter.sortField
      ? next
      : { ...next, sort_field: "rank", sort_order: "asc" };
  }, [filter, scope, searchQuery]);
  // isPending (not isLoading) — see useActiveVault for the rationale.
  const {
    data: issues,
    isPending,
    isFetching,
    isError,
  } = useIssueList(vault, query);
  const staleWindowDays = useResolvedAutoHideWindows(vault);
  const { data: relations } = useIssueRelations(vault);
  const { data: planningCatalog } = usePlanningCatalog(vault);
  const { data: assignees } = useUserSearch("", vault);
  const mutation = useUpdateIssue();
  const reorder = useReorderBacklog();
  const openIssue = useOpenIssue();
  const activeIssueId = useBoardStore((state) => state.activeIssueId);
  const setActiveIssueId = useBoardStore((state) => state.setActiveIssueId);
  const flashIssue = useFlashStore((state) => state.flashIssue);
  const [pendingClose, setPendingClose] = useState<{
    issue: IssueListItem;
    bucket: IssueGroupBucket;
  } | null>(null);

  // PointerSensor just starts a drag after a small distance — anything
  // shorter is treated as a click and reaches KanbanCard's onClick.
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 6 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  const sensors = useSensors(
    ...(effectiveGroupBy === "label" ? [] : [pointerSensor, keyboardSensor]),
  );

  const allIssues = issues ?? EMPTY_ISSUES;
  // Dependency graph: prefer the whole-vault relation projection; fall back to
  // the displayed set until it loads (or in tests without a relations mock).
  const graph = relations ?? allIssues;
  // Resolve every card's blocked state once instead of letting each card
  // re-derive it from the whole graph (O(n²) → O(n)); the cards get a primitive
  // `blocked` boolean so `memo` can skip the unchanged ones. `depends_on` comes
  // from `allIssues` (the optimistically-updated list) while statuses come from
  // `graph`, matching the old per-card `isBlocked(issue, graph)` so an
  // optimistic dependency edit isn't masked by the slower relations refetch.
  // (REEF-097)
  const blockedIds = useMemo(
    () => computeBlockedIds(allIssues, graph),
    [allIssues, graph],
  );
  const visibleIssues = useMemo(() => {
    const filtered = filterIssues(allIssues, scopedFilter, {
      searchActive: searchQuery.trim().length > 0,
      staleWindowDays,
    });
    const searched = searchIssues(filtered, searchQuery);
    const depFiltered = applyDependencyFilter(
      searched,
      scopedFilter.dependencyFilter ?? null,
      graph,
    );
    // Explicit user sorts still match the list comparator (REEF-059). With no
    // selected sort, the board shows reef's issue-wide rank order seeded by
    // backlog reorder or trusted imports (REEF-393); grouping preserves that
    // order inside each workflow column.
    return scopedFilter.sortField
      ? sortIssues(depFiltered, scopedFilter.sortField, scopedFilter.sortOrder)
      : sortIssuesByRankOrder(depFiltered);
  }, [allIssues, graph, scopedFilter, searchQuery, staleWindowDays]);
  // The filtered list controls card visibility; the full `allIssues` list
  // still powers dependency lookups so hidden deps can resolve accurately.
  // Active uses workflow-status columns; Backlog uses fixed Priority columns.
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
  const assigneeNames = useMemo(
    () =>
      Object.fromEntries(
        (assignees ?? []).map((assignee) => [
          assignee.login,
          assignee.name?.trim() || assignee.login,
        ]),
      ),
    [assignees],
  );
  const descriptor = useMemo(
    () =>
      createIssueGroupDescriptor(effectiveGroupBy, {
        labels: {
          none: t("groupNone"),
          status: statusLabels,
          priority: priorityLabels,
        },
        assigneeNames,
        sprintNames,
      }),
    [
      assigneeNames,
      effectiveGroupBy,
      priorityLabels,
      sprintNames,
      statusLabels,
      t,
    ],
  );
  const issueGroups = useMemo<IssueGroup[]>(
    () => descriptor.bucketsForIssues(visibleIssues),
    [descriptor, visibleIssues],
  );
  const hasActiveFilters =
    hasScopeFilters(filter, searchQuery, scope) ||
    Boolean(filter.showArchived || (scope === "active" && filter.showStale));
  const showNoMatch =
    !isFetching && !isError && visibleIssues.length === 0 && hasActiveFilters;
  const renderedOccurrences = useMemo(
    () =>
      issueGroups.flatMap(({ bucket, issues }) =>
        issues.map((issue) => ({
          key: `${bucket.id}:${issue.id}`,
          issueId: issue.id,
        })),
      ),
    [issueGroups],
  );
  useEffect(() => {
    useIssueKeyboardStore
      .getState()
      .setVisibleOccurrences("board", renderedOccurrences);
    return () => {
      useIssueKeyboardStore.getState().setVisibleOccurrences("board", []);
    };
  }, [renderedOccurrences]);

  const issueMap = useMemo<Map<string, IssueListItem>>(
    () => new Map(allIssues.map((i) => [i.id, i])),
    [allIssues],
  );

  const bucketById = useMemo(
    () => new Map(issueGroups.map(({ bucket }) => [bucket.id, bucket])),
    [issueGroups],
  );

  const orderedBacklog = useMemo(
    () =>
      sortIssuesByRankOrder(
        allIssues.filter(
          (issue) => issue.status === "backlog" && issue.archived_at == null,
        ),
      ),
    [allIssues],
  );
  const canReorderBacklog =
    scope === "backlog" &&
    !filter.sortField &&
    !filter.showArchived &&
    !reorder.isPending &&
    !mutation.isPending;

  function operationForBucket(
    bucket: IssueGroupBucket,
    closedReason?: ClosedReason,
  ): BulkIssueOperation | null {
    if (bucket.patchField === "status" && bucket.patchValue) {
      return {
        kind: "status",
        value: bucket.patchValue as Status,
        closedReason,
      };
    }
    if (bucket.patchField === "priority") {
      return {
        kind: "priority",
        value: bucket.patchValue as Priority | null,
      };
    }
    if (bucket.patchField === "assigned_to") {
      return { kind: "assignee", value: bucket.patchValue };
    }
    if (bucket.patchField === "sprint_id") {
      return { kind: "sprint", value: bucket.patchValue };
    }
    return null;
  }

  // Grouped-field writes surface failure per request via the mutateAsync promise, not
  // mutate's shared callbacks. The board stays draggable while a PATCH is in
  // flight, and `mutate`'s per-call onError lives on the single mutation
  // observer — a later move overwrites it, dropping the retry toast for an
  // earlier failed move. Each mutateAsync promise is independent, so every
  // failed move surfaces its own retry. Retry re-runs the exact same input; a
  // later success dismisses any lingering toast under the same id.
  function runGroupUpdate(input: {
    id: string;
    vault: string;
    patch: IssueUpdatePatch;
  }) {
    mutation.mutateAsync(input).then(
      () => {
        toast.dismiss(kanbanToastId(input.id));
        // Confirm the move landed server-side with a one-shot flash on the card.
        flashIssue(input.id);
      },
      (err: unknown) => {
        notifyRetryableError({
          id: kanbanToastId(input.id),
          title:
            err instanceof Error && err.message
              ? err.message
              : t("updateErrorTitle"),
          description: t("updateErrorDescription"),
          labels: {
            retry: common("retry"),
            retrying: toasts("retrying"),
          },
          onRetry: () => runGroupUpdate(input),
        });
      },
    );
  }

  function runBacklogReorder(input: {
    ordered: IssueListItem[];
    fromIndex: number;
    toIndex: number;
  }) {
    reorder.mutateAsync({ vault, ...input }).then(
      () =>
        toast.dismiss(kanbanToastId(input.ordered[input.fromIndex]?.id ?? "")),
      (err: unknown) => {
        const id = input.ordered[input.fromIndex]?.id ?? "backlog";
        notifyRetryableError({
          id: kanbanToastId(id),
          title:
            err instanceof Error && err.message
              ? err.message
              : backlogT("reorderErrorTitle"),
          description: backlogT("reorderErrorDescription"),
          labels: {
            retry: common("retry"),
            retrying: toasts("retrying"),
          },
          onRetry: () => runBacklogReorder(input),
        });
      },
    );
  }

  function backlogDropIndex(
    issue: IssueListItem,
    targetPriority: Priority | null,
  ) {
    const fromIndex = orderedBacklog.findIndex((item) => item.id === issue.id);
    if (fromIndex < 0) return null;
    const targetIndexes = orderedBacklog
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) =>
          item.id !== issue.id && (item.priority ?? null) === targetPriority,
      )
      .map(({ index }) => index);
    const lastTargetIndex = targetIndexes.at(-1);
    const toIndex =
      lastTargetIndex === undefined
        ? 0
        : fromIndex <= lastTargetIndex
          ? lastTargetIndex
          : lastTargetIndex + 1;
    return { fromIndex, toIndex };
  }

  function handleBacklogDrop(issue: IssueListItem, bucket: IssueGroupBucket) {
    if (!canReorderBacklog || bucket.patchField !== "priority") return;
    const targetPriority = bucket.patchValue as Priority | null;
    const indexes = backlogDropIndex(issue, targetPriority);
    if (!indexes) return;
    if (
      indexes.fromIndex === indexes.toIndex &&
      (issue.priority ?? null) === targetPriority
    ) {
      return;
    }

    if ((issue.priority ?? null) === targetPriority) {
      runBacklogReorder({
        ordered: orderedBacklog,
        fromIndex: indexes.fromIndex,
        toIndex: indexes.toIndex,
      });
      return;
    }

    if (indexes.fromIndex !== indexes.toIndex) {
      runBacklogReorder({
        ordered: orderedBacklog,
        fromIndex: indexes.fromIndex,
        toIndex: indexes.toIndex,
      });
    }
    runGroupUpdate({
      id: issue.id,
      vault,
      patch: { priority: targetPriority },
    });
  }

  function handleDragStart(event: DragStartEvent) {
    const issue = event.active.data.current?.issue as IssueListItem | undefined;
    if (issue) {
      setActiveIssueId(issue.id);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveIssueId(null);

    if (!over || !active.data.current) return;
    const bucket =
      (over.data?.current?.bucket as IssueGroupBucket | undefined) ??
      bucketById.get(String(over.id));
    if (!bucket?.droppable) return;

    const issue = active.data.current.issue as IssueListItem;
    if (scope === "backlog") {
      handleBacklogDrop(issue, bucket);
      return;
    }
    const operation = operationForBucket(bucket);
    if (!operation) return;
    const patch = buildBulkIssuePatch(issue, operation);
    if (!patch) return;

    if (operation.kind === "status" && operation.value === "closed") {
      setPendingClose({ issue, bucket });
      return;
    }

    runGroupUpdate({
      id: issue.id,
      vault,
      patch,
    });
  }

  function confirmClose(reason: ClosedReason) {
    if (!pendingClose) return;
    const { issue, bucket } = pendingClose;
    setPendingClose(null);
    const operation = operationForBucket(bucket, reason);
    if (!operation) return;
    const patch = buildBulkIssuePatch(issue, operation);
    if (!patch) return;
    runGroupUpdate({
      id: issue.id,
      vault,
      patch,
    });
  }

  const activeIssue = activeIssueId ? issueMap.get(activeIssueId) : undefined;
  const announcements = useMemo<Announcements>(() => {
    const positionOf = (id: string | undefined) => {
      if (!id) return null;
      const index = orderedBacklog.findIndex((issue) => issue.id === id);
      return index < 0 ? null : index + 1;
    };
    const positionForDropTarget = (id: string | undefined) => {
      const direct = positionOf(id);
      if (direct !== null) return direct;
      const bucket = issueGroups.find(
        ({ bucket: candidate }) => candidate.id === id,
      );
      const lastIssue = bucket?.issues.at(-1);
      return lastIssue ? positionOf(lastIssue.id) : bucket ? 1 : null;
    };
    return {
      onDragStart: ({ active }) =>
        backlogT("dragStart", { id: String(active.id) }),
      onDragOver: ({ active, over }) => {
        const position = positionForDropTarget(
          over ? String(over.id) : undefined,
        );
        return position === null
          ? undefined
          : backlogT("dragOver", { id: String(active.id), position });
      },
      onDragEnd: ({ active, over }) => {
        const position = positionForDropTarget(
          over ? String(over.id) : undefined,
        );
        return position === null
          ? undefined
          : backlogT("dragEnd", { id: String(active.id), position });
      },
      onDragCancel: ({ active }) =>
        backlogT("dragCancel", { id: String(active.id) }),
    };
  }, [backlogT, issueGroups, orderedBacklog]);

  if (isPending) {
    return <BoardColumnsSkeleton ariaLabel={t("columnsScrollRegion")} />;
  }

  if (
    scope === "backlog" &&
    !isFetching &&
    !isError &&
    visibleIssues.length === 0 &&
    !hasActiveFilters
  ) {
    return <BacklogBoardEmpty vault={vault} />;
  }

  return (
    <div data-testid="kanban-board" className="flex h-full min-h-0 flex-col">
      {isError && (
        <div className="mx-6 mt-4 rounded-md border border-destructive-focus/30 bg-destructive-fill/5 px-3 py-2 text-sm text-destructive-text">
          {t("loadError")}
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        accessibility={scope === "backlog" ? { announcements } : undefined}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveIssueId(null)}
      >
        <div
          data-testid="kanban-board-body"
          role="region"
          aria-label={t("columnsScrollRegion")}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The labeled overflow region is the keyboard scrollport.
          tabIndex={0}
          onKeyDown={handleBoardScrollKeyDown}
          className="relative grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-x-hidden overflow-y-auto px-6 py-4 md:grid-cols-2 lg:flex lg:flex-nowrap lg:overflow-x-auto lg:overflow-y-hidden"
        >
          {issueGroups.map(({ bucket, issues }) => (
            <KanbanColumn
              key={bucket.id}
              bucket={bucket}
              vault={vault}
              issues={issues}
              blockedIds={blockedIds}
              planningCatalog={planningCatalog}
              assignees={assignees}
              onIssueClick={openIssue}
              dragEnabled={
                scope === "active"
                  ? bucket.droppable
                  : canReorderBacklog && bucket.droppable
              }
              readOnlyReason={
                effectiveGroupBy === "label" ? t("groupReadOnly") : undefined
              }
            />
          ))}
          {showNoMatch && (
            <div className="pointer-events-none absolute inset-x-6 top-16 z-10 flex justify-center">
              <div className="pointer-events-none flex max-w-md flex-col items-center rounded-lg border border-border-subtle bg-surface-page/95 px-5 py-4 text-center backdrop-blur-sm">
                <section
                  data-testid="kanban-no-matches"
                  className="pointer-events-none flex flex-col items-center"
                  aria-labelledby={`${noMatchId}-title`}
                  aria-describedby={`${noMatchId}-description`}
                >
                  <h2
                    id={`${noMatchId}-title`}
                    className="text-sm font-semibold text-foreground"
                  >
                    {t("noMatchTitle")}
                  </h2>
                  <p
                    id={`${noMatchId}-description`}
                    className="mt-1 text-xs text-muted-foreground"
                  >
                    {t("noMatchDescription")}
                  </p>
                </section>
                <Button
                  className="pointer-events-auto mt-3"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => useIssueStore.getState().clearFilter()}
                >
                  {common("clearFilters")}
                </Button>
              </div>
            </div>
          )}
        </div>
        <DragOverlay dropAnimation={DROP_ANIMATION}>
          {activeIssue ? (
            <KanbanCardPreview
              issue={activeIssue}
              blocked={blockedIds.has(activeIssue.id)}
              planningCatalog={planningCatalog}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      <CloseIssueDialog
        open={pendingClose !== null}
        issueId={pendingClose?.issue.id ?? ""}
        disabled={mutation.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingClose(null);
        }}
        onConfirm={confirmClose}
      />
    </div>
  );
}

function BacklogBoardEmpty({ vault }: { vault: string }) {
  const t = useTranslations("issues.backlog");
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center"
      data-testid="backlog-board-empty"
    >
      <p className="text-sm font-medium text-foreground">
        {t("boardEmptyTitle")}
      </p>
      <p className="max-w-md text-sm text-muted-foreground">
        {t("boardEmptyDescription")}
      </p>
      <Link
        href={withVault(vault, "/issues?scope=backlog&view=list")}
        className="text-[13px] font-medium text-brand-text hover:underline"
      >
        {t("goToList")}
      </Link>
    </div>
  );
}
