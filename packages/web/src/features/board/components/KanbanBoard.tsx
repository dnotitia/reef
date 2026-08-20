"use client";

import { BoardColumnsSkeleton } from "@/components/BoardColumnsSkeleton";
import { Button } from "@/components/ui/button";
import {
  kanbanToastId,
  notifyRetryableError,
} from "@/components/ui/toastFeedback";
import { CloseIssueDialog } from "@/features/issues/components/detail/CloseIssueDialog";
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
  hasActiveIssueFilters,
  searchIssues,
  sortIssues,
  sortIssuesByRankOrder,
} from "@/features/issues/lib/issueListUtils";
import {
  createIssueGroupDescriptor,
  type IssueGroup,
  type IssueGroupBucket,
} from "@/features/issues/lib/grouping";
import type { IssueGroupBy } from "@/features/issues/lib/groupBy";
import { useFlashStore } from "@/features/issues/stores/useFlashStore";
import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { usePlanningCatalog } from "@/features/planning/hooks/usePlanningCatalog";
import { useUserSearch } from "@/features/issues/hooks/queries/useUserSearch";
import { activateButtonOnKeyDown } from "@/lib/keyboard";
import { DURATION_BASE, EASE_SIGNATURE } from "@/lib/motionTokens";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  type DropAnimation,
  PointerSensor,
  defaultDropAnimationSideEffects,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type {
  ClosedReason,
  IssueListItem,
  IssueUpdatePatch,
  Priority,
  Status,
} from "@reef/core";
import { usePriorityLabels, useStatusLabels } from "@/i18n/fieldLabels";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
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
  groupBy?: IssueGroupBy;
}

/**
 * Issues grouped into 5 columns by status with drag-and-drop via
 * @dnd-kit/core. User-driven board edits allow moving an issue to any valid
 * status column, matching the issue detail status picker.
 */
export function KanbanBoard({ vault, groupBy = "status" }: KanbanBoardProps) {
  // The board has no backlog column; keep a stray backlog status filter from
  // blanking it (REEF-109).
  useWorkflowStatusGuard();
  const t = useTranslations("board");
  const common = useTranslations("common");
  const statusLabels = useStatusLabels();
  const priorityLabels = usePriorityLabels();
  const noMatchId = useId();
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  // Server-side narrows the transfer (facets + free-text search); the client
  // pipeline below still applies due/label/dependency residuals and grouping.
  // The whole-vault relation projection backs blocker badges + the dependency
  // filter so they stay correct over the server-filtered subset.
  const query = useMemo(() => {
    const next = buildIssueQuery(filter, searchQuery);
    return filter.sortField
      ? next
      : { ...next, sort_field: "rank", sort_order: "asc" };
  }, [filter, searchQuery]);
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
  const sensors = useSensors(...(groupBy === "label" ? [] : [pointerSensor]));

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
    // Explicit user sorts still match the list comparator (REEF-059). With no
    // selected sort, the board shows reef's issue-wide rank order seeded by
    // backlog reorder or trusted imports (REEF-393); grouping preserves that
    // order inside each workflow column.
    return filter.sortField
      ? sortIssues(depFiltered, filter.sortField, filter.sortOrder)
      : sortIssuesByRankOrder(depFiltered);
  }, [allIssues, filter, graph, searchQuery, staleWindowDays]);
  // The filtered list controls card visibility; the full `allIssues` list
  // still powers dependency lookups so hidden deps can resolve accurately.
  // Columns are the active workflow statuses just; `backlog` has no column, so
  // a backlog issue in the fetched set finds no bucket here and is left off the
  // board — it lives in the dedicated backlog view instead (REEF-109).
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
      createIssueGroupDescriptor(groupBy, {
        labels: {
          none: t("groupNone"),
          status: statusLabels,
          priority: priorityLabels,
        },
        assigneeNames,
        sprintNames,
      }),
    [assigneeNames, groupBy, priorityLabels, sprintNames, statusLabels, t],
  );
  const issueGroups = useMemo<IssueGroup[]>(
    () => descriptor.bucketsForIssues(visibleIssues),
    [descriptor, visibleIssues],
  );
  const hasActiveFilters =
    hasActiveIssueFilters(filter, searchQuery) ||
    Boolean(filter.showArchived || filter.showStale);
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
          onRetry: () => runGroupUpdate(input),
        });
      },
    );
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

  if (isPending) {
    return <BoardColumnsSkeleton ariaLabel={t("columnsScrollRegion")} />;
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
              readOnlyReason={
                groupBy === "label" ? t("groupReadOnly") : undefined
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
                  onKeyDown={activateButtonOnKeyDown}
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
