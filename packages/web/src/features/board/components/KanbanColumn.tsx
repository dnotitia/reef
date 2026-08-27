"use client";

import { StatusIcon } from "@/components/ui/status-icon";
import { DURATION_BASE, EASE_SIGNATURE } from "@/lib/motionTokens";
import { cn } from "@/lib/utils";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import type {
  Collaborator,
  IssueListItem,
  PlanningCatalog,
  Status,
} from "@reef/core";
import { memo } from "react";
import type {
  IssueGroupBucket,
  StatusHierarchyFallback,
} from "../../issues/lib/grouping";
import { KanbanCard } from "./KanbanCard";

const EMPTY_BLOCKED_IDS: ReadonlySet<string> = new Set();

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
  dragEnabled?: boolean;
  readOnlyReason?: string;
  hierarchyFallbackByIssueId?: ReadonlyMap<string, StatusHierarchyFallback>;
  className?: string;
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
  dragEnabled,
  readOnlyReason,
  hierarchyFallbackByIssueId,
  className,
}: KanbanColumnProps) {
  const canDrag = dragEnabled ?? bucket.droppable;
  const { setNodeRef, isOver } = useDroppable({
    id: bucket.id,
    data: { bucket },
    disabled: !canDrag,
  });
  // Layout transition: when a card joins/leaves this column (status change) or
  // the filtered/sorted set shifts, auto-animate FLIPs it into place instead
  // of a hard unmount/remount. The drag gesture itself stays owned by
  // @dnd-kit; this just animates data-driven membership changes, and honors
  // prefers-reduced-motion by default.
  const [cardListRef] = useAutoAnimate<HTMLDivElement>({
    duration: DURATION_BASE,
    easing: EASE_SIGNATURE,
  });
  return (
    <div
      ref={setNodeRef}
      data-group-by={bucket.groupBy}
      data-group-value={bucket.value ?? "none"}
      aria-label={`${bucket.label}, ${issues.length}`}
      className={cn(
        "flex h-full min-w-0 w-full flex-col rounded-lg border border-border bg-surface-subtle p-2 lg:w-80 lg:shrink-0",
        "transition-colors duration-150",
        isOver &&
          "border-brand-focus bg-surface-hover ring-2 ring-brand-focus/30",
        className,
      )}
    >
      {/* Column header */}
      <div className="mb-2 flex shrink-0 items-center gap-2 px-1.5 py-1">
        {bucket.groupBy === "status" && bucket.value ? (
          <StatusIcon status={bucket.value as Status} size={12} />
        ) : null}
        <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
          {bucket.label}
        </h3>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
          {issues.length}
        </span>
      </div>

      {/* Cards — scroll within the column when many */}
      <SortableContext
        items={issues.map((issue) => `${bucket.id}:${issue.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={cardListRef}
          className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
        >
          {issues.map((issue) => (
            <KanbanCard
              key={`${bucket.id}:${issue.id}`}
              vault={vault}
              issue={issue}
              bucket={bucket}
              occurrenceKey={`${bucket.id}:${issue.id}`}
              dragEnabled={canDrag}
              readOnlyReason={readOnlyReason}
              blocked={blockedIds.has(issue.id)}
              planningCatalog={planningCatalog}
              assignees={assignees}
              onClick={onIssueClick}
              hierarchyFallback={hierarchyFallbackByIssueId?.get(issue.id)}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
});
