"use client";

import { StatusIcon } from "@/components/ui/status-icon";
import { DURATION_BASE, EASE_SIGNATURE } from "@/lib/motionTokens";
import { cn } from "@/lib/utils";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import type {
  Collaborator,
  IssueListItem,
  PlanningCatalog,
  Status,
} from "@reef/core";
import { ExternalLink } from "lucide-react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useStatusLabels } from "@/i18n/fieldLabels";
import { useTranslations } from "next-intl";
import type { IssueGroupBucket } from "../../issues/lib/grouping";
import type { IssueReorderSurfaceState } from "../../issues/components/shared/IssueReorderFeedback";
import { useIssueKeyboardStore } from "../../issues/stores/useIssueKeyboardStore";
import { KanbanCard } from "./KanbanCard";

const EMPTY_BLOCKED_IDS: ReadonlySet<string> = new Set();
const CARD_ESTIMATED_HEIGHT = 176;
const CARD_OVERSCAN = 4;
const INITIAL_CARD_SCROLL_RECT = { width: 320, height: 480 };

export interface KanbanColumnProps {
  bucket: IssueGroupBucket;
  vault?: string;
  issues: IssueListItem[];
  /**
   * Blocked-issue ids precomputed once by the board (see `computeBlockedIds`).
   * The column resolves each card's blocked badge with `Set.has` (O(1)) and
   * passes the resolved boolean down, so cards stay `memo`-stable. (REEF-097)
   */
  blockedIds?: ReadonlySet<string>;
  planningCatalog?: PlanningCatalog;
  assignees?: readonly Collaborator[];
  onIssueClick?: (id: string) => void;
  onGroupClick?: (id: string) => void;
  dragEnabled?: boolean;
  dragRestrictionReason?: string;
  reorderIssueId?: string | null;
  reorderState?: IssueReorderSurfaceState | null;
  autoAnimateEnabled?: boolean;
  activeIssueId?: string | null;
  focusRequestBaselineSerial?: number;
  quickEditRequestBaselineSerial?: number;
}

// Drop hover uses neutral surface + brand ring, not purple, to avoid
// clashing with the AI-purple semantics reserved for AI features.
export const KanbanColumn = memo(function KanbanColumn({
  bucket,
  vault,
  issues,
  blockedIds = EMPTY_BLOCKED_IDS,
  planningCatalog,
  assignees,
  onIssueClick,
  onGroupClick,
  dragEnabled,
  dragRestrictionReason,
  reorderIssueId,
  reorderState,
  autoAnimateEnabled = true,
  activeIssueId = null,
  focusRequestBaselineSerial = -1,
  quickEditRequestBaselineSerial = -1,
}: KanbanColumnProps) {
  const t = useTranslations("board");
  const statusLabels = useStatusLabels();
  const isEpicGroup = bucket.groupBy === "epic";
  const epic = bucket.epic;
  const cardDragRestrictionReason = isEpicGroup
    ? undefined
    : dragRestrictionReason;
  const canDrag = dragEnabled ?? bucket.droppable;
  const { setNodeRef, isOver } = useDroppable({
    id: bucket.id,
    data: { bucket },
    disabled: !canDrag,
  });
  const [cardListRef, setAutoAnimateEnabled] = useAutoAnimate<HTMLDivElement>({
    duration: DURATION_BASE,
    easing: EASE_SIGNATURE,
  });
  const scrollElementRef = useRef<HTMLDivElement | null>(null);
  const setCardListRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollElementRef.current = node;
      cardListRef(node);
    },
    [cardListRef],
  );
  useLayoutEffect(() => {
    setAutoAnimateEnabled?.(autoAnimateEnabled);
  }, [autoAnimateEnabled, setAutoAnimateEnabled]);

  const activeIndex = activeIssueId
    ? issues.findIndex((issue) => issue.id === activeIssueId)
    : -1;
  const issueIndexesById = useMemo(
    () => new Map(issues.map((issue, index) => [issue.id, index])),
    [issues],
  );
  const issueIndexesByOccurrenceKey = useMemo(
    () =>
      new Map(
        issues.map((issue, index) => [`${bucket.id}:${issue.id}`, index]),
      ),
    [bucket.id, issues],
  );
  const sortableIds = useMemo(
    () => issues.map((issue) => `${bucket.id}:${issue.id}`),
    [bucket.id, issues],
  );
  // TanStack Virtual exposes imperative methods outside React Compiler's safe
  // memoization model; keep the compiler skip local to this integration point.
  // eslint-disable-next-line react-hooks/incompatible-library -- the issue list uses this established virtualizer API too.
  const virtualizer = useVirtualizer({
    count: issues.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => CARD_ESTIMATED_HEIGHT,
    getItemKey: (index) => `${bucket.id}:${issues[index]?.id ?? index}`,
    initialRect: INITIAL_CARD_SCROLL_RECT,
    overscan: CARD_OVERSCAN,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      return activeIndex < 0 || indexes.includes(activeIndex)
        ? indexes
        : [...indexes, activeIndex].sort((left, right) => left - right);
    },
  });

  const pendingFocusRequest = useIssueKeyboardStore((state) => {
    const focusRequest = state.focusRequest;
    const quickEditRequest = state.quickEditRequest;
    const request =
      focusRequest?.scope === "board" &&
      focusRequest.serial > focusRequestBaselineSerial
        ? focusRequest
        : quickEditRequest?.scope === "board" &&
            quickEditRequest.serial > quickEditRequestBaselineSerial
          ? quickEditRequest
          : null;
    if (!request) return null;
    const matchesOccurrence =
      request.occurrenceKey !== undefined &&
      issueIndexesByOccurrenceKey.has(request.occurrenceKey);
    const matchesIssue =
      bucket.groupBy !== "label" && issueIndexesById.has(request.issueId);
    return matchesOccurrence || matchesIssue ? request : null;
  });
  const requestedIndex = pendingFocusRequest
    ? (issueIndexesByOccurrenceKey.get(
        pendingFocusRequest.occurrenceKey ?? "",
      ) ??
      (bucket.groupBy !== "label"
        ? (issueIndexesById.get(pendingFocusRequest.issueId) ?? -1)
        : -1))
    : -1;

  useLayoutEffect(() => {
    if (requestedIndex >= 0 && pendingFocusRequest) {
      virtualizer.scrollToIndex(requestedIndex, { align: "auto" });
    }
  }, [pendingFocusRequest, requestedIndex, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  return (
    <div
      ref={setNodeRef}
      data-group-by={bucket.groupBy}
      data-group-value={bucket.value ?? "none"}
      aria-label={
        bucket.epic
          ? t("epicColumnLabel", {
              id: bucket.epic.id,
              title: bucket.epic.title,
              status: statusLabels[bucket.epic.status],
              count: issues.length,
              done: bucket.progress?.done ?? 0,
              total: bucket.progress?.total ?? issues.length,
            })
          : `${bucket.label}, ${issues.length}`
      }
      className={cn(
        "flex h-full min-w-0 w-full flex-col rounded-lg border border-border bg-surface-subtle p-2 lg:w-80 lg:shrink-0",
        "transition-colors duration-150",
        isOver &&
          "border-brand-focus bg-surface-hover ring-2 ring-brand-focus/30",
      )}
    >
      {/* Column header */}
      <div
        className="mb-2 flex min-w-0 shrink-0 items-center gap-2 px-1.5 py-1"
        data-testid={epic ? "epic-group-header" : "kanban-group-header"}
      >
        {bucket.groupBy === "status" && bucket.value ? (
          <StatusIcon status={bucket.value as Status} size={12} />
        ) : null}
        <h3
          className={cn(
            epic ? "type-board-epic" : "type-board-status",
            "min-w-0 flex-1 text-foreground/80",
          )}
        >
          {epic ? (
            <span className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
              <span className="shrink-0 type-compact-mono text-muted-foreground">
                {epic.id}
              </span>
              <span className="min-w-0 truncate" title={epic.title}>
                {epic.title}
              </span>
            </span>
          ) : (
            bucket.label
          )}
        </h3>
        <span className="ml-auto shrink-0 type-compact-mono text-muted-foreground">
          {issues.length}
        </span>
        {epic ? (
          <button
            type="button"
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus"
            aria-label={t("openEpic", {
              id: epic.id,
              title: epic.title,
            })}
            data-testid={`open-epic-${epic.id}`}
            title={epic.title}
            onClick={() => onGroupClick?.(epic.id)}
          >
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </div>

      {/* Cards — scroll within the column when many */}
      <SortableContext
        items={sortableIds}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setCardListRef}
          className="min-h-0 max-h-[calc(100dvh_-_8rem)] flex-1 overflow-y-auto overscroll-contain lg:max-h-none"
          data-testid="kanban-column-scroll-container"
        >
          <div
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualItem) => {
              const issue = issues[virtualItem.index];
              if (!issue) return null;
              const occurrenceKey = `${bucket.id}:${issue.id}`;
              return (
                <div
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  className="absolute left-0 top-0 w-full pb-1.5"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <KanbanCard
                    vault={vault}
                    issue={issue}
                    bucket={bucket}
                    occurrenceKey={occurrenceKey}
                    dragEnabled={canDrag}
                    dragRestrictionReason={cardDragRestrictionReason}
                    blocked={blockedIds.has(issue.id)}
                    planningCatalog={planningCatalog}
                    assignees={assignees}
                    onClick={onIssueClick}
                    focusRequestBaselineSerial={focusRequestBaselineSerial}
                    reorderState={
                      reorderIssueId === issue.id
                        ? (reorderState ?? null)
                        : null
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      </SortableContext>
    </div>
  );
});
