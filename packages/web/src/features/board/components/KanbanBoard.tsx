"use client";

import { BoardColumnsSkeleton } from "@/components/BoardColumnsSkeleton";
import {
  STATUS_OPTIONS,
  WORKFLOW_STATUS_OPTIONS,
} from "@/components/ui/status-icon";
import {
  kanbanToastId,
  notifyRetryableError,
} from "@/components/ui/toastFeedback";
import { CloseIssueDialog } from "@/features/issues/components/detail/CloseIssueDialog";
import { useUpdateIssue } from "@/features/issues/hooks/mutations/useUpdateIssue";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueRelations } from "@/features/issues/hooks/queries/useIssueRelations";
import { useOpenIssue } from "@/features/issues/hooks/view/useOpenIssue";
import { useWorkflowStatusGuard } from "@/features/issues/hooks/view/useWorkflowStatusGuard";
import { buildIssueQuery } from "@/features/issues/lib/buildIssueQuery";
import {
  applyDependencyFilter,
  computeBlockedIds,
} from "@/features/issues/lib/dependencyUtils";
import {
  filterIssues,
  searchIssues,
  sortIssues,
} from "@/features/issues/lib/issueListUtils";
import { buildStatusPatch } from "@/features/issues/lib/statusPatch";
import { useFlashStore } from "@/features/issues/stores/useFlashStore";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { usePlanningCatalog } from "@/features/planning/hooks/usePlanningCatalog";
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
import type { ClosedReason, IssueListItem, Status } from "@reef/core";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useBoardStore } from "../stores/useBoardStore";
import { KanbanCardPreview } from "./KanbanCard";
import { KanbanColumn } from "./KanbanColumn";

const EMPTY_ISSUES: IssueListItem[] = [];
const STATUS_SET = new Set<Status>(STATUS_OPTIONS);

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
}

/**
 * Issues grouped into 5 columns by status with drag-and-drop via
 * @dnd-kit/core. User-driven board edits allow moving an issue to any valid
 * status column, matching the issue detail status picker.
 */
export function KanbanBoard({ vault }: KanbanBoardProps) {
  // The board has no backlog column; keep a stray backlog status filter from
  // blanking it (REEF-109).
  useWorkflowStatusGuard();
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  // Server-side narrows the transfer (facets + free-text search); the client
  // pipeline below still applies due/label/dependency residuals and grouping.
  // The whole-vault relation projection backs blocker badges + the dependency
  // filter so they stay correct over the server-filtered subset.
  const query = useMemo(
    () => buildIssueQuery(filter, searchQuery),
    [filter, searchQuery],
  );
  // isPending (not isLoading) — see useActiveVault for the rationale.
  const { data: issues, isPending, isError } = useIssueList(vault, query);
  const { data: relations } = useIssueRelations(vault);
  const { data: planningCatalog } = usePlanningCatalog(vault);
  const mutation = useUpdateIssue();
  const openIssue = useOpenIssue();
  const activeIssueId = useBoardStore((state) => state.activeIssueId);
  const setActiveIssueId = useBoardStore((state) => state.setActiveIssueId);
  const flashIssue = useFlashStore((state) => state.flashIssue);
  const [pendingCloseIssue, setPendingCloseIssue] =
    useState<IssueListItem | null>(null);

  // PointerSensor just starts a drag after a small distance — anything
  // shorter is treated as a click and reaches KanbanCard's onClick.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
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
    const filtered = filterIssues(allIssues, filter);
    const searched = searchIssues(filtered, searchQuery);
    const depFiltered = applyDependencyFilter(
      searched,
      filter.dependencyFilter ?? null,
      graph,
    );
    // Run the same comparator the list uses so both views order identically
    // (REEF-059). Grouping by status below preserves this order within each
    // column. An unset sort is a no-op here, leaving the server's default order.
    return sortIssues(depFiltered, filter.sortField, filter.sortOrder);
  }, [allIssues, filter, graph, searchQuery]);

  // The filtered list controls card visibility; the full `allIssues` list
  // still powers dependency lookups so hidden deps can resolve accurately.
  // Columns are the active workflow statuses just; `backlog` has no column, so
  // a backlog issue in the fetched set finds no bucket here and is left off the
  // board — it lives in the dedicated backlog view instead (REEF-109).
  const issuesByStatus = useMemo<Map<Status, IssueListItem[]>>(() => {
    const map = new Map<Status, IssueListItem[]>(
      WORKFLOW_STATUS_OPTIONS.map((s) => [s, []]),
    );
    for (const issue of visibleIssues) {
      map.get(issue.status)?.push(issue);
    }
    return map;
  }, [visibleIssues]);

  const issueMap = useMemo<Map<string, IssueListItem>>(
    () => new Map(allIssues.map((i) => [i.id, i])),
    [allIssues],
  );

  function isStatus(value: unknown): value is Status {
    return typeof value === "string" && STATUS_SET.has(value as Status);
  }

  // Status writes surface failure per request via the mutateAsync promise, not
  // mutate's shared callbacks. The board stays draggable while a PATCH is in
  // flight, and `mutate`'s per-call onError lives on the single mutation
  // observer — a later move overwrites it, dropping the retry toast for an
  // earlier failed move. Each mutateAsync promise is independent, so every
  // failed move surfaces its own retry. Retry re-runs the exact same input; a
  // later success dismisses any lingering toast under the same id.
  function runStatusUpdate(input: {
    id: string;
    vault: string;
    patch: ReturnType<typeof buildStatusPatch>;
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
              : "Couldn't update issue",
          description: "The board was reverted. Retry to move it again.",
          onRetry: () => runStatusUpdate(input),
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
    if (!isStatus(over.id)) return;

    const issue = active.data.current.issue as IssueListItem;
    const toStatus = over.id;

    if (issue.status === toStatus) return;

    if (toStatus === "closed") {
      setPendingCloseIssue(issue);
      return;
    }

    runStatusUpdate({
      id: issue.id,
      vault,
      patch: buildStatusPatch(issue, toStatus),
    });
  }

  function confirmClose(reason: ClosedReason) {
    if (!pendingCloseIssue) return;
    const issue = pendingCloseIssue;
    setPendingCloseIssue(null);
    runStatusUpdate({
      id: issue.id,
      vault,
      patch: buildStatusPatch(issue, "closed", undefined, reason),
    });
  }

  const activeIssue = activeIssueId ? issueMap.get(activeIssueId) : undefined;

  if (isPending) {
    return <BoardColumnsSkeleton />;
  }

  return (
    <div data-testid="kanban-board" className="flex h-full min-h-0 flex-col">
      {isError && (
        <div className="mx-6 mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Failed to load some issues. Displaying cached data if available.
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveIssueId(null)}
      >
        <div className="flex flex-1 min-h-0 gap-3 overflow-x-auto px-6 py-4">
          {WORKFLOW_STATUS_OPTIONS.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              issues={issuesByStatus.get(status) ?? EMPTY_ISSUES}
              blockedIds={blockedIds}
              planningCatalog={planningCatalog}
              onIssueClick={openIssue}
            />
          ))}
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
        open={pendingCloseIssue !== null}
        issueId={pendingCloseIssue?.id ?? ""}
        disabled={mutation.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingCloseIssue(null);
        }}
        onConfirm={confirmClose}
      />
    </div>
  );
}
