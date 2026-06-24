"use client";

import { EnumSelectField } from "@/components/fields/EnumSelectField";
import { personToneFor } from "@/components/fields/PersonAvatar";
import { PersonChip } from "@/components/fields/PersonChip";
import { TypePill } from "@/components/fields/TypePill";
import { PriorityBadge } from "@/components/ui/priority-dot";
import { StatusBadge } from "@/components/ui/status-icon";
import { TableCell, TableRow } from "@/components/ui/table";
import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import { formatRelativeTime } from "@/features/issues/lib/formatRelativeTime";
import { cn } from "@/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { IssueListItem, Status } from "@reef/core";
import { STATUS_OPTIONS } from "@reef/core/fields";
import { GripVertical } from "lucide-react";
import { useLocale } from "next-intl";

// Hoisted so it is not re-created per render (the status picker renders one per
// option, per row).
const renderStatusOption = (s: Status) => <StatusBadge status={s} />;

interface BacklogRowProps {
  issue: IssueListItem;
  onOpen: (id: string) => void;
  onStatusChange: (issue: IssueListItem, nextStatus: Status) => void;
  /**
   * Manual-order mode (REEF-129): the row is drag-reorderable by its grip
   * handle. When false (a user sort is active) the grip is inert and the row is
   * a static triage row.
   */
  sortable?: boolean;
}

/**
 * Slim triage row for the backlog view: Grip · Type · ID · Title · Status ·
 * Priority · Assignee · Updated. In manual-order mode the leading grip is a
 * drag handle; the Status cell is an inline picker so a backlog issue can be
 * promoted to Todo in place (REEF-109). Clicking the row opens the issue; the
 * grip and the status picker stop propagation so neither navigates.
 */
export function BacklogRow({
  issue,
  onOpen,
  onStatusChange,
  sortable = false,
}: BacklogRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id, disabled: !sortable });
  const currentLogin = useCurrentUserLogin();
  const locale = useLocale();

  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group cursor-pointer transition-colors duration-150 hover:bg-surface-hover",
        // Lift the dragged row out of the flow with the board's drag treatment.
        isDragging &&
          "relative z-10 bg-elevated shadow-md ring-1 ring-brand/40",
      )}
      onClick={() => onOpen(issue.id)}
      data-testid="backlog-row"
    >
      {/* Grip — drag handle, revealed on hover/focus, interactive just in
          manual-order mode. The empty span keeps the column width stable when a
          user sort disables reordering. */}
      <TableCell className="w-7 pr-0 text-muted-foreground">
        {sortable ? (
          <button
            type="button"
            aria-label={`Reorder ${issue.id}`}
            data-testid={`backlog-grip-${issue.id}`}
            className="flex cursor-grab touch-none items-center rounded-sm opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <span className="block h-4 w-4" aria-hidden="true" />
        )}
      </TableCell>

      {/* Type */}
      <TableCell>
        <TypePill type={issue.issue_type} variant="list" />
      </TableCell>

      {/* ID */}
      <TableCell className="w-24 font-mono text-xs text-muted-foreground">
        {issue.id}
      </TableCell>

      {/* Title */}
      <TableCell className="max-w-xs">
        <span className="line-clamp-1 font-medium text-foreground">
          {issue.title}
        </span>
      </TableCell>

      {/* Status — inline picker. The click guard just stops the parent row's
          navigation; the Select inside owns its own keyboard handling. */}
      <TableCell onClick={(e) => e.stopPropagation()}>
        <div className="w-[150px]">
          <EnumSelectField
            value={issue.status}
            onValueChange={(val) => onStatusChange(issue, val as Status)}
            options={STATUS_OPTIONS}
            renderItem={renderStatusOption}
            testId={`backlog-status-select-${issue.id}`}
          />
        </div>
      </TableCell>

      {/* Priority */}
      <TableCell>
        {issue.priority ? (
          <PriorityBadge priority={issue.priority} />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Assignee */}
      <TableCell className="text-sm">
        {issue.assigned_to ? (
          <PersonChip
            identityKey={issue.assigned_to}
            size="sm"
            tone={personToneFor(issue.assigned_to, currentLogin)}
          />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Updated */}
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {formatRelativeTime(issue.updated_at, locale)}
      </TableCell>
    </TableRow>
  );
}
