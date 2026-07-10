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
import { IssueQuickEditAnchor } from "@/features/issues/components/quick-edit/IssueQuickEditAnchor";
import { IssueSelectionCheckbox } from "@/features/issues/components/shared/IssueSelectionCheckbox";
import { useIssueFlash } from "@/features/issues/stores/useFlashStore";
import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import { findPlanningName } from "@/features/planning/lib/planningItems";
import { cn } from "@/lib/utils";
import type { IssueListItem, PlanningCatalog } from "@reef/core";
import { useLocale, useTranslations } from "next-intl";
import { type MouseEvent, memo, useEffect, useRef } from "react";
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
  logicalIds?: readonly string[];
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
  logicalIds = [],
  onClick,
}: IssueListRowProps) {
  const issue = useIssueEntity(vault, seed.id) ?? seed;
  const blocked = isBlocked(issue, allIssues);
  const blockerCount = blocked
    ? getUnresolvedBlockerCount(issue, allIssues)
    : 0;
  const isFlashing = useIssueFlash(issue.id);
  const focused = useIssueKeyboardStore(
    (state) => state.focusedIssueId.list === issue.id,
  );
  const tabStopped = useIssueKeyboardStore(
    (state) => state.tabStopIssueId.list === issue.id,
  );
  const focusRequest = useIssueKeyboardStore((state) => state.focusRequest);
  const focusIssue = useIssueKeyboardStore((state) => state.focusIssue);
  const selected = useIssueSelectionStore((state) =>
    state.selectedIds.has(issue.id),
  );
  const selectionRunning = useIssueSelectionStore((state) => state.running);
  const bulk = useTranslations("issues.bulk");
  const currentLogin = useCurrentUserLogin();
  const locale = useLocale();
  const rowRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (
      focusRequest?.scope !== "list" ||
      focusRequest.issueId !== issue.id ||
      !rowRef.current
    ) {
      return;
    }
    rowRef.current.focus({ preventScroll: true });
    rowRef.current.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusRequest, issue.id]);

  useEffect(() => {
    const row = rowRef.current;
    const container = row?.closest('[data-slot="table-container"]');
    if (!focused || !row || !(container instanceof HTMLElement)) {
      return;
    }

    const syncFocusChrome = () => {
      row.style.setProperty(
        "--reef-list-focus-left",
        `${container.scrollLeft}px`,
      );
      row.style.setProperty(
        "--reef-list-focus-width",
        `${container.clientWidth}px`,
      );
    };

    syncFocusChrome();
    container.addEventListener("scroll", syncFocusChrome, { passive: true });
    window.addEventListener("resize", syncFocusChrome);

    return () => {
      container.removeEventListener("scroll", syncFocusChrome);
      window.removeEventListener("resize", syncFocusChrome);
      row.style.removeProperty("--reef-list-focus-left");
      row.style.removeProperty("--reef-list-focus-width");
    };
  }, [focused]);

  return (
    <TableRow
      ref={rowRef}
      className={cn(
        "reef-issue-list-row group cursor-pointer transition-colors duration-150 focus-visible:outline-none",
        onClick && "hover:bg-surface-hover",
        focused && "bg-brand/5",
        selected && "bg-brand/10 ring-1 ring-inset ring-brand/50",
        isFlashing && "reef-flash-row",
      )}
      tabIndex={focused || tabStopped ? 0 : -1}
      aria-selected={selected || undefined}
      onFocus={() => focusIssue("list", issue.id)}
      onClick={(event: MouseEvent<HTMLTableRowElement>) => {
        if (event.shiftKey) {
          event.preventDefault();
          useIssueSelectionStore.getState().extendRange(issue.id, logicalIds);
          return;
        }
        onClick?.(issue.id);
      }}
      data-testid="issue-list-row"
      data-issue-id={issue.id}
      data-shortcut-surface="issue-list-row"
      data-keyboard-focused={focused ? "true" : undefined}
    >
      <TableCell className="w-9 px-2">
        <IssueSelectionCheckbox
          checked={selected}
          disabled={selectionRunning}
          label={bulk("selectIssue", { id: issue.id })}
          className={cn(
            "opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100",
            selected && "opacity-100",
          )}
          testId="issue-row-checkbox"
          onChange={(event) => {
            if ((event.nativeEvent as globalThis.MouseEvent).shiftKey) {
              useIssueSelectionStore
                .getState()
                .extendRange(issue.id, logicalIds);
              return;
            }
            useIssueSelectionStore.getState().toggle(issue.id);
          }}
        />
      </TableCell>
      {/* ID */}
      <TableCell className="relative w-24 font-mono text-xs text-muted-foreground">
        {issue.id}
        <IssueQuickEditAnchor scope="list" issue={issue} vault={vault} />
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
        {formatRelativeTime(issue.updated_at, locale)}
      </TableCell>

      {/* Blocked indicator */}
      <TableCell>
        {blocked && <BlockedBadge variant="list" count={blockerCount} />}
      </TableCell>
    </TableRow>
  );
});
