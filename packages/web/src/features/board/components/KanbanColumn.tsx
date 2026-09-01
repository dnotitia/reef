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
import { ExternalLink } from "lucide-react";
import { memo } from "react";
import { useStatusLabels } from "@/i18n/fieldLabels";
import { useTranslations } from "next-intl";
import type { IssueGroupBucket } from "../../issues/lib/grouping";
import type { IssueReorderSurfaceState } from "../../issues/components/shared/IssueReorderFeedback";
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
  onGroupClick?: (id: string) => void;
  dragEnabled?: boolean;
  readOnlyReason?: string;
  reorderIssueId?: string | null;
  reorderState?: IssueReorderSurfaceState | null;
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
  readOnlyReason,
  reorderIssueId,
  reorderState,
}: KanbanColumnProps) {
  const t = useTranslations("board");
  const statusLabels = useStatusLabels();
  const isEpicGroup = bucket.groupBy === "epic";
  const epic = bucket.epic;
  const cardReadOnlyReason = isEpicGroup ? undefined : readOnlyReason;
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
            "min-w-0 flex-1 text-xs font-semibold text-foreground/80",
            !epic && "uppercase tracking-wide",
          )}
        >
          {epic ? (
            <span className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
              <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">
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
        <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {issues.length}
        </span>
        {epic ? (
          <button
            type="button"
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus/40"
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
              readOnlyReason={cardReadOnlyReason}
              blocked={blockedIds.has(issue.id)}
              planningCatalog={planningCatalog}
              assignees={assignees}
              onClick={onIssueClick}
              reorderState={
                reorderIssueId === issue.id ? (reorderState ?? null) : null
              }
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
});
