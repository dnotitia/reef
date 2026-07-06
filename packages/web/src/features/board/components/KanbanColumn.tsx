"use client";

import { StatusIcon } from "@/components/ui/status-icon";
import { useStatusLabels } from "@/i18n/fieldLabels";
import { DURATION_BASE, EASE_SIGNATURE } from "@/lib/motionTokens";
import { cn } from "@/lib/utils";
import { useDroppable } from "@dnd-kit/core";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import type { IssueListItem, PlanningCatalog, Status } from "@reef/core";
import { memo } from "react";
import { KanbanCard } from "./KanbanCard";

const EMPTY_BLOCKED_IDS: ReadonlySet<string> = new Set();

export interface KanbanColumnProps {
  status: Status;
  vault?: string;
  issues: IssueListItem[];
  /**
   * Blocked-issue ids precomputed once by the board (see `computeBlockedIds`).
   * The column resolves each card's blocked badge with `Set.has` (O(1)) and
   * passes the resolved boolean down, so cards stay `memo`-stable. (REEF-097)
   */
  blockedIds?: ReadonlySet<string>;
  planningCatalog?: PlanningCatalog;
  onIssueClick?: (id: string) => void;
}

// Drop hover uses neutral surface + brand ring, not purple, to avoid
// clashing with the AI-purple semantics reserved for AI features.
export const KanbanColumn = memo(function KanbanColumn({
  status,
  vault,
  issues,
  blockedIds = EMPTY_BLOCKED_IDS,
  planningCatalog,
  onIssueClick,
}: KanbanColumnProps) {
  const statusLabels = useStatusLabels();
  const { setNodeRef, isOver } = useDroppable({ id: status });
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
      className={cn(
        "flex h-full w-80 shrink-0 flex-col rounded-lg border border-border bg-surface-subtle p-2",
        "transition-colors duration-150",
        isOver && "border-brand bg-surface-hover ring-2 ring-brand/30",
      )}
    >
      {/* Column header */}
      <div className="mb-2 flex shrink-0 items-center gap-2 px-1.5 py-1">
        <StatusIcon status={status} size={12} />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
          {statusLabels[status]}
        </h3>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
          {issues.length}
        </span>
      </div>

      {/* Cards — scroll within the column when many */}
      <div
        ref={cardListRef}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
      >
        {issues.map((issue) => (
          <KanbanCard
            key={issue.id}
            vault={vault}
            issue={issue}
            blocked={blockedIds.has(issue.id)}
            planningCatalog={planningCatalog}
            onClick={onIssueClick}
          />
        ))}
      </div>
    </div>
  );
});
