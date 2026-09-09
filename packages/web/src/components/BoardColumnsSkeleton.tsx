"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { StatusIcon } from "@/components/ui/status-icon";
import { usePriorityLabels, useStatusLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type { Status } from "@reef/core";
import { PRIORITY_OPTIONS, WORKFLOW_STATUS_OPTIONS } from "@reef/core/fields";
import { useTranslations } from "next-intl";

/**
 * Placeholder for the board's fixed columns. Shared by the live board's pending
 * state (KanbanBoard) and the first-paint app shell (AppShellSkeleton) so both
 * render the same column frame. Fixed status/priority labels stay visible while
 * data-defined groups remain neutral until their values resolve. (REEF-097)
 */
interface BoardColumnsSkeletonProps {
  className?: string;
  ariaLabel?: string;
  /** The known fixed buckets for the surface that is pending. */
  scope?: "active" | "backlog";
  /** Dynamic grouping stays unlabeled until its data-defined buckets resolve. */
  groupBy?:
    | "status"
    | "priority"
    | "assignee"
    | "sprint"
    | "label"
    | "epic"
    | "none";
}

const EMPTY_COLUMN_KEYS = ["one", "two", "three", "four", "five"] as const;
const CARD_KEYS = ["a", "b", "c"] as const;

function LoadingColumn({
  label,
  index,
  status,
}: {
  label?: string;
  index: number;
  status?: Status;
}) {
  return (
    <div className="flex h-full min-w-0 w-full flex-col rounded-lg border border-border bg-surface-subtle p-2 lg:w-80 lg:shrink-0">
      <div
        className="mb-2 flex min-w-0 shrink-0 items-center gap-2 px-1.5 py-1"
        data-testid="kanban-group-header"
      >
        {status ? <StatusIcon status={status} size={12} decorative /> : null}
        {label ? (
          <h3 className="min-w-0 flex-1 truncate type-board-status text-foreground/80">
            {label}
          </h3>
        ) : (
          <Skeleton aria-hidden="true" tone="secondary" className="h-3 w-20" />
        )}
        <Skeleton
          aria-hidden="true"
          tone="secondary"
          className="h-3 w-5 shrink-0"
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5" aria-hidden="true">
        {CARD_KEYS.map((key, cardIndex) => (
          <Skeleton
            key={`${index}-${key}`}
            className={cn(
              "h-20 w-full",
              cardIndex === 1 && "h-24",
              cardIndex === 2 && "h-16",
            )}
          />
        ))}
      </div>
    </div>
  );
}

export function BoardColumnsSkeleton({
  ariaLabel,
  className,
  scope = "active",
  groupBy,
}: BoardColumnsSkeletonProps) {
  const board = useTranslations("board");
  const statusLabels = useStatusLabels();
  const priorityLabels = usePriorityLabels();
  const labels =
    groupBy === "status" || (groupBy === undefined && scope === "active")
      ? WORKFLOW_STATUS_OPTIONS.map((status) => statusLabels[status])
      : groupBy === "priority" || (groupBy === undefined && scope === "backlog")
        ? [
            ...PRIORITY_OPTIONS.map((priority) => priorityLabels[priority]),
            board("groupNone"),
          ]
        : [];
  const columnLabels = labels.length > 0 ? labels : EMPTY_COLUMN_KEYS;

  return (
    <div
      data-testid="board-columns-skeleton"
      className={cn(
        "relative grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-x-hidden overflow-y-auto px-6 py-4 md:grid-cols-2 lg:flex lg:flex-nowrap lg:overflow-x-auto lg:overflow-y-hidden",
        className,
      )}
      role={ariaLabel ? "region" : undefined}
      aria-label={ariaLabel}
      aria-busy={ariaLabel ? true : undefined}
      tabIndex={ariaLabel ? 0 : undefined}
    >
      {columnLabels.map((label, index) => (
        <LoadingColumn
          key={`${label}-${index}`}
          label={labels.length > 0 ? label : undefined}
          index={index}
          status={
            groupBy === "status" ||
            (groupBy === undefined && scope === "active")
              ? WORKFLOW_STATUS_OPTIONS[index]
              : undefined
          }
        />
      ))}
    </div>
  );
}
