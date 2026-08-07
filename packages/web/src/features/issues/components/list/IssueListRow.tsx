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
import {
  ISSUE_LIST_DEFAULT_COLUMNS,
  ISSUE_TABLE_COLUMN_WIDTHS,
  type IssueListColumnKey,
  isIssueTableStickyColumn,
  issueTableColumnOffset,
} from "@/features/issues/components/shared/issueTableContract";
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
  columns?: readonly IssueListColumnKey[];
  onClick?: (id: string) => void;
}

function issueListCellClass(column: IssueListColumnKey, stateClass?: string) {
  return cn(
    "h-10 min-w-0 px-3 py-0 align-middle",
    isIssueTableStickyColumn(column) &&
      "sticky z-10 bg-background group-hover:bg-surface-hover",
    column === "title" && "min-w-[15rem]",
    stateClass,
  );
}

function issueListCellStyle(
  columns: readonly IssueListColumnKey[],
  column: IssueListColumnKey,
) {
  return {
    ...(column === "title"
      ? { minWidth: ISSUE_TABLE_COLUMN_WIDTHS.title }
      : { width: ISSUE_TABLE_COLUMN_WIDTHS[column] }),
    ...(isIssueTableStickyColumn(column)
      ? { left: issueTableColumnOffset(columns, column) }
      : {}),
  };
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
  columns = ISSUE_LIST_DEFAULT_COLUMNS,
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
  const stickyStateClass = selected || focused ? "bg-brand/5" : undefined;

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
    const container =
      row?.closest('[data-testid="issue-list-scroll-container"]') ??
      row?.closest('[data-slot="table-container"]');
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
        "reef-issue-list-row group h-10 cursor-pointer transition-colors duration-150 focus-visible:outline-none",
        onClick && "hover:bg-surface-hover",
        focused && "bg-brand/5",
        selected && "bg-brand/5 ring-1 ring-inset ring-brand/30",
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
      <TableCell
        className={cn(
          issueListCellClass("select", stickyStateClass),
          "w-10 px-2",
        )}
        style={issueListCellStyle(columns, "select")}
        data-column-key="select"
      >
        <IssueSelectionCheckbox
          checked={selected}
          disabled={selectionRunning}
          label={bulk("selectIssue", { id: issue.id })}
          className={cn(
            "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
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
      <TableCell
        className={cn(
          issueListCellClass("id", stickyStateClass),
          "relative font-mono text-xs text-muted-foreground",
        )}
        style={issueListCellStyle(columns, "id")}
        data-column-key="id"
      >
        {issue.id}
        <IssueQuickEditAnchor scope="list" issue={issue} vault={vault} />
      </TableCell>

      {/* Type */}
      <TableCell
        className={issueListCellClass("type", stickyStateClass)}
        style={issueListCellStyle(columns, "type")}
        data-column-key="type"
      >
        <TypePill type={issue.issue_type} variant="list" />
      </TableCell>

      {/* Title */}
      <TableCell
        className={issueListCellClass("title", stickyStateClass)}
        style={issueListCellStyle(columns, "title")}
        data-column-key="title"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {issue.title}
          </span>
          {blocked && <BlockedBadge variant="list" count={blockerCount} />}
        </span>
      </TableCell>

      {/* Status */}
      <TableCell
        className={issueListCellClass("status")}
        style={issueListCellStyle(columns, "status")}
        data-column-key="status"
      >
        <StatusBadge status={issue.status} />
      </TableCell>

      {/* Priority */}
      <TableCell
        className={issueListCellClass("priority")}
        style={issueListCellStyle(columns, "priority")}
        data-column-key="priority"
      >
        {issue.priority ? (
          <PriorityBadge priority={issue.priority} />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Assignee */}
      <TableCell
        className={cn(issueListCellClass("assignee"), "text-sm")}
        style={issueListCellStyle(columns, "assignee")}
        data-column-key="assignee"
      >
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
      {columns.includes("start") && (
        <TableCell
          className="h-10 min-w-0 px-3 py-0 text-xs whitespace-nowrap text-muted-foreground"
          style={issueListCellStyle(columns, "start")}
          data-column-key="start"
        >
          <DateDisplay date={issue.start_date} emptyText="—" />
        </TableCell>
      )}

      {/* Sprint */}
      {columns.includes("sprint") && (
        <TableCell
          className="h-10 min-w-0 px-3 py-0 text-xs text-muted-foreground"
          style={issueListCellStyle(columns, "sprint")}
          data-column-key="sprint"
        >
          {findPlanningName(planningCatalog, "sprints", issue.sprint_id) ?? "—"}
        </TableCell>
      )}

      {/* Milestone */}
      {columns.includes("milestone") && (
        <TableCell
          className="h-10 min-w-0 px-3 py-0 text-xs text-muted-foreground"
          style={issueListCellStyle(columns, "milestone")}
          data-column-key="milestone"
        >
          {findPlanningName(
            planningCatalog,
            "milestones",
            issue.milestone_id,
          ) ?? "—"}
        </TableCell>
      )}

      {/* Release */}
      {columns.includes("release") && (
        <TableCell
          className="h-10 min-w-0 px-3 py-0 text-xs text-muted-foreground"
          style={issueListCellStyle(columns, "release")}
          data-column-key="release"
        >
          {findPlanningName(planningCatalog, "releases", issue.release_id) ??
            "—"}
        </TableCell>
      )}

      {/* Due */}
      {columns.includes("due") && (
        <TableCell
          className="h-10 min-w-0 px-3 py-0 text-xs whitespace-nowrap text-muted-foreground"
          style={issueListCellStyle(columns, "due")}
          data-column-key="due"
        >
          <DateDisplay date={issue.due_date} emptyText="—" />
        </TableCell>
      )}

      {/* Updated */}
      {columns.includes("updated") && (
        <TableCell
          className="h-10 min-w-0 px-3 py-0 text-xs whitespace-nowrap text-muted-foreground"
          style={issueListCellStyle(columns, "updated")}
          data-column-key="updated"
        >
          {formatRelativeTime(issue.updated_at, locale)}
        </TableCell>
      )}
    </TableRow>
  );
});
