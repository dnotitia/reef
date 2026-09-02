"use client";

import { BoardColumnsSkeleton } from "@/components/BoardColumnsSkeleton";
import { Button } from "@/components/ui/button";
import {
  kanbanToastId,
  notifyReorderFailure,
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
import {
  buildIssueQuery,
  buildManualIssueQuery,
} from "@/features/issues/lib/buildIssueQuery";
import {
  buildBulkIssuePatch,
  type BulkIssueOperation,
} from "@/features/issues/lib/bulkIssueUpdate";
import {
  buildIssueReorderTargetForBoardDrop,
  type IssueReorderGroupInput,
  type IssueReorderTarget,
} from "@/features/issues/lib/issueReorder";
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
  buildIssueHierarchyCatalog,
  createIssueGroupDescriptor,
  type IssueGroup,
  type IssueGroupBucket,
} from "@/features/issues/lib/grouping";
import type { IssueGroupBy } from "@/features/issues/lib/groupBy";
import type { IssueScope } from "@/features/issues/lib/viewMode";
import { useFlashStore } from "@/features/issues/stores/useFlashStore";
import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import {
  IssueReorderAnnouncement,
  type IssueReorderSurfaceState,
} from "@/features/issues/components/shared/IssueReorderFeedback";
import {
  isManualOrdering,
  useIssueStore,
} from "@/features/issues/stores/useIssueStore";
import { usePlanningCatalog } from "@/features/planning/hooks/usePlanningCatalog";
import { useUserSearch } from "@/features/issues/hooks/queries/useUserSearch";
import { DURATION_BASE, EASE_SIGNATURE } from "@/lib/motionTokens";
import {
  DndContext,
  type Announcements,
  type CollisionDetection,
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
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const boardCollisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);
  const issueCollision = collisions.find((collision) => {
    const data = collision.data?.droppableContainer.data.current as
      | { issue?: unknown }
      | undefined;
    return data?.issue != null;
  });
  return issueCollision ? [issueCollision] : collisions;
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
  const groupT = useTranslations("issues.filters");
  const backlogT = useTranslations("issues.backlog");
  const reorderT = useTranslations("issues.reorder");
  const common = useTranslations("common");
  const toasts = useTranslations("toasts");
  const locale = useLocale();
  const statusLabels = useStatusLabels();
  const priorityLabels = usePriorityLabels();
  const noMatchId = useId();
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  const scopedFilter = useMemo(
    () => filterForIssueScope(filter, scope),
    [filter, scope],
  );
  const manualOrder = isManualOrdering(filter);
  // Server-side narrows the transfer (facets + free-text search); the client
  // pipeline below still applies due/label/dependency residuals and grouping.
  // The whole-vault relation projection backs blocker badges + the dependency
  // filter so they stay correct over the server-filtered subset.
  const query = useMemo(() => {
    if (manualOrder) {
      return buildManualIssueQuery(filter, scope);
    }
    return buildIssueQuery(filter, searchQuery, scope);
  }, [filter, manualOrder, scope, searchQuery]);
  // isPending (not isLoading) — see useActiveVault for the rationale.
  const {
    data: issues,
    isPending,
    isFetching,
    isError,
    isPlaceholderData,
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
    target?: IssueReorderTarget;
  } | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState<string>("");
  const lastPointerCoordinatesRef = useRef<{ x: number; y: number } | null>(
    null,
  );

  // PointerSensor just starts a drag after a small distance — anything
  // shorter is treated as a click and reaches KanbanCard's onClick.
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 6 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  // Keep the hook's dependency shape stable while label grouping remains
  // read-only. The cards and columns gate their own drag affordances with
  // dragEnabled, so the stable context sensors cannot activate a label drag.
  const sensors = useSensors(pointerSensor, keyboardSensor);

  const allIssues = issues ?? EMPTY_ISSUES;
  // Dependency graph: prefer the whole-vault relation projection; fall back to
  // the displayed set until it loads (or in tests without a relations mock).
  const graph = relations ?? allIssues;
  const hierarchyCatalog = useMemo(
    () => buildIssueHierarchyCatalog(relations, allIssues),
    [allIssues, relations],
  );
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
    return manualOrder
      ? sortIssuesByRankOrder(depFiltered)
      : sortIssues(depFiltered, scopedFilter.sortField, scopedFilter.sortOrder);
  }, [
    allIssues,
    graph,
    manualOrder,
    scopedFilter,
    searchQuery,
    staleWindowDays,
  ]);
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
          epic: {
            none: groupT("group.noEpic"),
            unavailableParent: groupT("group.unavailableParent"),
          },
        },
        assigneeNames,
        sprintNames,
        hierarchyCatalog,
        locale,
      }),
    [
      assigneeNames,
      effectiveGroupBy,
      priorityLabels,
      sprintNames,
      statusLabels,
      groupT,
      hierarchyCatalog,
      locale,
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
  }, [renderedOccurrences]);

  useEffect(() => {
    return () => {
      useIssueKeyboardStore.getState().setVisibleOccurrences("board", []);
    };
  }, []);

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
  const canonicalBoardIssues = useMemo(
    () => sortIssuesByRankOrder(allIssues),
    [allIssues],
  );
  const canReorderManualBoard =
    manualOrder &&
    !filter.showArchived &&
    !isFetching &&
    !isPlaceholderData &&
    !reorder.isPending;
  const canReorderBacklog =
    scope === "backlog" && canReorderManualBoard && !mutation.isPending;
  const reorderIssueId =
    reorder.variables?.vault === vault && reorder.variables.scope === scope
      ? reorder.variables.issueId
      : null;
  const reorderState: IssueReorderSurfaceState | null = reorder.isPending
    ? "pending"
    : reorder.isError
      ? "error"
      : null;

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
        flashIssue(vault, input.id);
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

  function runReorder(input: {
    target: IssueReorderTarget;
    group?: IssueReorderGroupInput;
  }) {
    const issueId = input.target.issueId;
    setReorderAnnouncement(reorderT("reorderSaving", { id: issueId }));
    useIssueKeyboardStore.getState().focusIssue("board", input.target.issueId, {
      requestDomFocus: true,
    });
    reorder
      .mutateAsync({
        vault,
        scope,
        ...input.target,
        ...(input.group ? { group: input.group } : {}),
      })
      .then(
        () => {
          toast.dismiss(kanbanToastId(issueId));
          setReorderAnnouncement(reorderT("reorderSaved", { id: issueId }));
        },
        (err: unknown) => {
          setReorderAnnouncement(reorderT("reorderFailed", { id: issueId }));
          notifyReorderFailure(
            err,
            {
              id: kanbanToastId(issueId),
              title: backlogT("reorderErrorTitle"),
              description: backlogT("reorderErrorDescription"),
              labels: {
                retry: common("retry"),
                retrying: toasts("retrying"),
              },
              onRetry: () => runReorder(input),
            },
            {
              title: backlogT("reorderConflictTitle"),
              description: backlogT("reorderConflictDescription"),
            },
          );
        },
      );
  }

  function groupForBucket(
    bucket: IssueGroupBucket,
  ): IssueReorderGroupInput | undefined {
    if (
      bucket.patchField !== "status" &&
      bucket.patchField !== "priority" &&
      bucket.patchField !== "assigned_to" &&
      bucket.patchField !== "sprint_id"
    ) {
      return undefined;
    }
    return { field: bucket.patchField, value: bucket.patchValue };
  }

  function issueGroupValue(
    issue: IssueListItem,
    field: IssueReorderGroupInput["field"],
  ): string | null {
    switch (field) {
      case "status":
        return issue.status;
      case "priority":
        return issue.priority ?? null;
      case "assigned_to":
        return issue.assigned_to ?? null;
      case "sprint_id":
        return issue.sprint_id ?? null;
    }
  }

  function issueBelongsToBucket(
    issue: IssueListItem,
    bucket: IssueGroupBucket,
  ): boolean {
    if (bucket.patchField === null || bucket.patchField === "labels") {
      return bucket.groupBy === "none";
    }
    return issueGroupValue(issue, bucket.patchField) === bucket.patchValue;
  }

  function handleDragStart(event: DragStartEvent) {
    const issue = event.active.data.current?.issue as IssueListItem | undefined;
    if (issue) {
      setActiveIssueId(issue.id);
    }
  }

  // PointerSensor can activate on the first move without emitting a later
  // collision update when a pointer jumps directly to its destination. Use
  // the final rendered DOM target only to recover that drop target; canonical
  // rank resolution remains owned by the shared reorder helper and server.
  function pointerDropTargetAtLastPointer(): {
    id: string;
    issue?: IssueListItem;
    bucket: IssueGroupBucket;
  } | null {
    const point = lastPointerCoordinatesRef.current;
    if (
      !point ||
      typeof document === "undefined" ||
      typeof document.elementFromPoint !== "function"
    ) {
      return null;
    }
    const element = document.elementFromPoint(point.x, point.y);
    const card = element?.closest<HTMLElement>(
      '[data-testid="kanban-card"][data-occurrence-key]',
    );
    const occurrenceKey = card?.dataset.occurrenceKey;
    if (occurrenceKey) {
      const group = issueGroups.find(({ bucket: candidate, issues }) =>
        issues.some((item) => `${candidate.id}:${item.id}` === occurrenceKey),
      );
      const issue = group?.issues.find(
        (item) => `${group.bucket.id}:${item.id}` === occurrenceKey,
      );
      if (group && issue) {
        return { id: occurrenceKey, issue, bucket: group.bucket };
      }
    }

    const column = element?.closest<HTMLElement>("[data-group-by]");
    if (!column) return null;
    const group = issueGroups.find(
      ({ bucket: candidate }) =>
        candidate.groupBy === column.dataset.groupBy &&
        (candidate.value ?? "none") === column.dataset.groupValue,
    );
    return group ? { id: group.bucket.id, bucket: group.bucket } : null;
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveIssueId(null);

    if (!active.data.current) return;
    const overData = over?.data?.current as
      | { bucket?: IssueGroupBucket; issue?: IssueListItem }
      | undefined;
    const issue = active.data.current.issue as IssueListItem;
    const isPointerDrag =
      event.activatorEvent?.type === "pointerdown" ||
      event.activatorEvent?.type === "mousedown";
    const pointerTarget = isPointerDrag
      ? pointerDropTargetAtLastPointer()
      : null;
    const rawOverId = over ? String(over.id) : null;
    const usePointerTarget =
      pointerTarget !== null &&
      (rawOverId === null ||
        rawOverId === String(active.id) ||
        overData?.issue?.id === issue.id);
    const resolvedOverData = usePointerTarget
      ? { issue: pointerTarget.issue, bucket: pointerTarget.bucket }
      : overData;
    const overId = usePointerTarget ? pointerTarget.id : rawOverId;
    lastPointerCoordinatesRef.current = null;
    const overGroup = issueGroups.find(
      ({ bucket: candidate, issues: bucketIssues }) =>
        candidate.id === overId ||
        bucketIssues.some(
          (item) =>
            item.id === overId || `${candidate.id}:${item.id}` === overId,
        ),
    );
    const overIssue =
      resolvedOverData?.issue ??
      overGroup?.issues.find(
        (item) =>
          item.id === overId || `${overGroup.bucket.id}:${item.id}` === overId,
      );
    const bucket =
      resolvedOverData?.bucket ??
      (overId ? bucketById.get(overId) : undefined) ??
      overGroup?.bucket;
    const manualUngroupedBucket =
      (manualOrder || scope === "backlog") && effectiveGroupBy === "none";
    if (!overId || !bucket || (!bucket.droppable && !manualUngroupedBucket)) {
      return;
    }

    const targetItems = canonicalBoardIssues.filter((candidate) =>
      issueBelongsToBucket(candidate, bucket),
    );
    const overIssueId = overIssue?.id;

    if (manualOrder || scope === "backlog") {
      if (scope === "active" && !canReorderManualBoard) return;
      if (scope === "backlog" && !canReorderBacklog) return;
      if (scope === "active" && !manualOrder) return;
      const target = buildIssueReorderTargetForBoardDrop(
        issue,
        targetItems,
        canonicalBoardIssues,
        overIssueId,
      );
      if (!target) return;
      const group = groupForBucket(bucket);
      if (group && issueGroupValue(issue, group.field) === group.value) {
        runReorder({ target });
        return;
      }
      if (group?.field === "status" && group.value === "closed") {
        setPendingClose({ issue, bucket, target });
        return;
      }
      runReorder({ target, group });
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
    const target = pendingClose.target;
    setPendingClose(null);
    if (target) {
      const group = groupForBucket(bucket);
      if (!group || group.field !== "status") return;
      runReorder({
        target,
        group: { ...group, closed_reason: reason },
      });
      return;
    }
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
    const announcementOrder =
      scope === "backlog"
        ? orderedBacklog
        : issueGroups.flatMap(({ issues: bucketIssues }) => bucketIssues);
    const positionOf = (id: string | undefined) => {
      if (!id) return null;
      const index = announcementOrder.findIndex((issue) => issue.id === id);
      return index < 0 ? null : index + 1;
    };
    const issueIdForTarget = (id: string | undefined) => {
      if (!id) return undefined;
      return issueGroups
        .flatMap(({ bucket, issues: bucketIssues }) =>
          bucketIssues.map((issue) => ({
            issue,
            occurrenceKey: `${bucket.id}:${issue.id}`,
          })),
        )
        .find(
          ({ issue, occurrenceKey }) => issue.id === id || occurrenceKey === id,
        )?.issue.id;
    };
    const positionForDropTarget = (id: string | undefined) => {
      const direct = positionOf(issueIdForTarget(id) ?? id);
      if (direct !== null) return direct;
      const bucket = issueGroups.find(
        ({ bucket: candidate }) => candidate.id === id,
      );
      const lastIssue = bucket?.issues.at(-1);
      return lastIssue ? positionOf(lastIssue.id) : bucket ? 1 : null;
    };
    return {
      onDragStart: ({ active }) =>
        backlogT("dragStart", {
          id: String(active.data.current?.issue?.id ?? active.id),
        }),
      onDragOver: ({ active, over }) => {
        const position = positionForDropTarget(
          over ? String(over.id) : undefined,
        );
        return position === null
          ? undefined
          : backlogT("dragOver", {
              id: String(active.data.current?.issue?.id ?? active.id),
              position,
            });
      },
      onDragEnd: ({ active, over }) => {
        const position = positionForDropTarget(
          over ? String(over.id) : undefined,
        );
        return position === null
          ? undefined
          : backlogT("dragEnd", {
              id: String(active.data.current?.issue?.id ?? active.id),
              position,
            });
      },
      onDragCancel: ({ active }) =>
        backlogT("dragCancel", {
          id: String(active.data.current?.issue?.id ?? active.id),
        }),
    };
  }, [backlogT, issueGroups, orderedBacklog, scope]);

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
      <IssueReorderAnnouncement message={reorderAnnouncement} />
      {isError && (
        <div className="mx-6 mt-4 rounded-md border border-destructive-focus/30 bg-destructive-fill/5 px-3 py-2 text-sm text-destructive-text">
          {t("loadError")}
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={boardCollisionDetection}
        accessibility={{ announcements }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={(event) => {
          const issue = event.active.data.current?.issue as
            | IssueListItem
            | undefined;
          if (issue) {
            useIssueKeyboardStore.getState().focusIssue("board", issue.id, {
              requestDomFocus: true,
            });
          }
          setActiveIssueId(null);
        }}
      >
        <div
          data-testid="kanban-board-body"
          role="region"
          aria-label={t("columnsScrollRegion")}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The labeled overflow region is the keyboard scrollport.
          tabIndex={0}
          onKeyDown={handleBoardScrollKeyDown}
          onPointerMove={(event) => {
            lastPointerCoordinatesRef.current = {
              x: event.clientX,
              y: event.clientY,
            };
          }}
          onPointerLeave={() => {
            lastPointerCoordinatesRef.current = null;
          }}
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
              reorderIssueId={reorderIssueId}
              reorderState={reorderState}
              onIssueClick={openIssue}
              onGroupClick={bucket.epic ? openIssue : undefined}
              dragEnabled={
                scope === "active"
                  ? (bucket.droppable ||
                      (manualOrder && effectiveGroupBy === "none")) &&
                    (!manualOrder || canReorderManualBoard)
                  : canReorderBacklog &&
                    (bucket.droppable || effectiveGroupBy === "none")
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
        <DragOverlay
          dropAnimation={prefersReducedMotion() ? undefined : DROP_ANIMATION}
        >
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
        className="type-control font-medium text-brand-text hover:underline"
      >
        {t("goToList")}
      </Link>
    </div>
  );
}
