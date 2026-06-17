"use client";

import { BlockedBadge } from "@/components/fields/BlockedBadge";
import { DateDisplay } from "@/components/fields/DateDisplay";
import { personToneFor } from "@/components/fields/PersonAvatar";
import { PersonChip } from "@/components/fields/PersonChip";
import { TypePill } from "@/components/fields/TypePill";
import { PriorityBadge } from "@/components/ui/priority-dot";
import { StatusBadge } from "@/components/ui/status-icon";
import { TableCell, TableRow } from "@/components/ui/table";
import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import { useIssueFlash } from "@/features/issues/stores/useFlashStore";
import { findPlanningName } from "@/features/planning/lib/planningItems";
import { cn } from "@/lib/utils";
import type { IssueListItem, PlanningCatalog } from "@reef/core";
import { memo } from "react";
import {
  type IssueRelationLike,
  getUnresolvedBlockerCount,
  isBlocked,
} from "../../lib/dependencyUtils";
import { formatRelativeTime } from "../../lib/formatRelativeTime";
import { useIssueEntity } from "../../stores/issueEntityStore";

interface IssueListRowProps {
  /**
   * Seed list item — covers the first paint before the list result is
   * normalized into the entity store. The store is the live render source
   * (see `issue` below), so the seed carries the row's id forward.
   */
  issue: IssueListItem;
  vault: string;
  allIssues: readonly IssueRelationLike[];
  highlightQuery?: string;
  planningCatalog?: PlanningCatalog;
  onClick?: (id: string) => void;
}

/**
 * `memo` + a single-entity store subscription make this row granular: a
 * non-membership edit to one issue re-renders that row (its store entity
 * changes), while sibling rows keep stable props and skip. (REEF-098)
 */
export const IssueListRow = memo(function IssueListRow({
  issue: seed,
  vault,
  allIssues,
  highlightQuery: _highlightQuery,
  planningCatalog,
  onClick,
}: IssueListRowProps) {
  const issue = useIssueEntity(vault, seed.id) ?? seed;
  const blocked = isBlocked(issue, allIssues);
  const blockerCount = blocked
    ? getUnresolvedBlockerCount(issue, allIssues)
    : 0;
  const isFlashing = useIssueFlash(issue.id);
  const currentLogin = useCurrentUserLogin();
  return (
    <TableRow
      className={cn(
        "cursor-pointer transition-colors duration-150",
        onClick && "hover:bg-surface-hover",
        isFlashing && "reef-flash-row",
      )}
      onClick={() => onClick?.(issue.id)}
      data-testid="issue-list-row"
    >
      {/* ID */}
      <TableCell className="font-mono text-xs text-muted-foreground w-24">
        {issue.id}
      </TableCell>

      {/* Type */}
      <TableCell>
        <TypePill type={issue.issue_type} variant="list" />
      </TableCell>

      {/* Title */}
      <TableCell className="max-w-xs">
        <span className="line-clamp-1 font-medium text-foreground">
          {issue.title}
        </span>
      </TableCell>

      {/* Status */}
      <TableCell>
        <StatusBadge status={issue.status} />
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

      {/* Start */}
      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
        <DateDisplay date={issue.start_date} emptyText="—" />
      </TableCell>

      {/* Due */}
      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
        <DateDisplay date={issue.due_date} emptyText="—" />
      </TableCell>

      <TableCell className="text-xs text-muted-foreground">
        {findPlanningName(planningCatalog, "sprints", issue.sprint_id) ?? "—"}
      </TableCell>

      <TableCell className="text-xs text-muted-foreground">
        {findPlanningName(planningCatalog, "milestones", issue.milestone_id) ??
          "—"}
      </TableCell>

      <TableCell className="text-xs text-muted-foreground">
        {findPlanningName(planningCatalog, "releases", issue.release_id) ?? "—"}
      </TableCell>

      {/* Updated */}
      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
        {formatRelativeTime(issue.updated_at)}
      </TableCell>

      {/* Blocked indicator */}
      <TableCell>
        {blocked && <BlockedBadge variant="list" count={blockerCount} />}
      </TableCell>
    </TableRow>
  );
});
