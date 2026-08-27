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
import { IssueInlineEditTrigger } from "@/features/issues/components/quick-edit/IssueInlineEditTrigger";
import { IssueListReorderHandle } from "@/features/issues/components/list/IssueListReorderHandle";
import { IssueQuickEditAnchor } from "@/features/issues/components/quick-edit/IssueQuickEditAnchor";
import { IssueContextMenu } from "@/features/issues/components/context-menu/IssueContextMenu";
import { IssueSelectionCheckbox } from "@/features/issues/components/shared/IssueSelectionCheckbox";
import {
  ISSUE_LIST_DEFAULT_COLUMNS,
  ISSUE_TABLE_COLUMN_WIDTHS,
  type IssueListColumnKey,
  isIssueTableStickyColumn,
  issueTableColumnOffset,
} from "@/features/issues/components/shared/issueTableContract";
import { useIssueFlash } from "@/features/issues/stores/useFlashStore";
import {
  type IssueQuickEditField,
  useIssueKeyboardStore,
} from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import { findPlanningName } from "@/features/planning/lib/planningItems";
import { cn } from "@/lib/utils";
import { useDroppable } from "@dnd-kit/core";
import type { Collaborator, IssueListItem, PlanningCatalog } from "@reef/core";
import { useFieldNameLabels } from "@/i18n/fieldLabels";
import { useLocale, useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  type MouseEvent,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
  assignees?: readonly Collaborator[];
  /** Current vault display names, indexed by stable assigned_to login. */
  assigneeNames?: Readonly<Record<string, string>>;
  logicalIds?: readonly string[];
  occurrenceKey?: string;
  columns?: readonly IssueListColumnKey[];
  sortable?: boolean;
  reorderHint?: string;
  onClick?: (id: string) => void;
}

type IssueListRowVisualState = "idle" | "focused" | "context-open" | "selected";

function isInteractiveRowTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        "button,a,input,select,textarea,[role=button],[role=checkbox]",
      ),
    )
  );
}

function issueListCellClass(
  column: IssueListColumnKey,
  visualState: IssueListRowVisualState,
) {
  const selectedOrFocused =
    visualState === "selected" || visualState === "focused";
  const activeBoundary = visualState !== "idle";

  return cn(
    "h-10 min-w-0 px-3 py-0 align-middle",
    isIssueTableStickyColumn(column) &&
      cn(
        "sticky",
        selectedOrFocused || visualState === "context-open"
          ? selectedOrFocused
            ? "reef-list-sticky-state"
            : "bg-surface-page"
          : "bg-surface-page group-hover:bg-surface-hover",
        column === "select"
          ? activeBoundary
            ? "z-40"
            : "z-10"
          : column === "id"
            ? "z-20"
            : "z-10",
      ),
    column === "title" && "min-w-[15rem]",
  );
}

function issueListCellStyle(
  columns: readonly IssueListColumnKey[],
  column: IssueListColumnKey,
  visualState: IssueListRowVisualState,
) {
  return {
    ...(column === "title"
      ? { minWidth: ISSUE_TABLE_COLUMN_WIDTHS.title }
      : { width: ISSUE_TABLE_COLUMN_WIDTHS[column] }),
    ...(isIssueTableStickyColumn(column)
      ? {
          left: issueTableColumnOffset(columns, column),
          position: "sticky" as const,
          zIndex:
            column === "select" && visualState !== "idle"
              ? 40
              : column === "id"
                ? 30
                : 10,
        }
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
  assignees,
  assigneeNames,
  logicalIds = [],
  occurrenceKey,
  columns = ISSUE_LIST_DEFAULT_COLUMNS,
  sortable = false,
  reorderHint,
  onClick,
}: IssueListRowProps) {
  const issue = useIssueEntity(vault, seed.id) ?? seed;
  const blocked = isBlocked(issue, allIssues);
  const blockerCount = blocked
    ? getUnresolvedBlockerCount(issue, allIssues)
    : 0;
  const isFlashing = useIssueFlash(issue.id);
  const keyboardOccurrenceKey = occurrenceKey ?? issue.id;
  const focused = useIssueKeyboardStore(
    (state) =>
      state.focusedOccurrenceKey.list === keyboardOccurrenceKey ||
      (!state.focusedOccurrenceKey.list &&
        state.focusedIssueId.list === issue.id),
  );
  const tabStopped = useIssueKeyboardStore(
    (state) =>
      state.tabStopOccurrenceKey.list === keyboardOccurrenceKey ||
      (!state.tabStopOccurrenceKey.list &&
        state.tabStopIssueId.list === issue.id),
  );
  const focusRequest = useIssueKeyboardStore((state) => state.focusRequest);
  const focusOccurrence = useIssueKeyboardStore(
    (state) => state.focusOccurrence,
  );
  const selected = useIssueSelectionStore((state) =>
    state.selectedIds.has(issue.id),
  );
  const selectionRunning = useIssueSelectionStore((state) => state.running);
  const [contextOpen, setContextOpen] = useState(false);
  const bulk = useTranslations("issues.bulk");
  const fieldNames = useFieldNameLabels();
  const currentLogin = useCurrentUserLogin();
  const locale = useLocale();
  const rowRef = useRef<HTMLTableRowElement | null>(null);
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: `issue-row:${issue.id}`,
    data: { issue },
    disabled: !sortable,
  });
  const statusTriggerRef = useRef<HTMLButtonElement>(null);
  const priorityTriggerRef = useRef<HTMLButtonElement>(null);
  const assigneeTriggerRef = useRef<HTMLButtonElement>(null);
  const setRowRef = useCallback(
    (node: HTMLTableRowElement | null) => {
      rowRef.current = node;
      setDroppableRef(node);
    },
    [setDroppableRef],
  );
  const getQuickEditAnchor = useCallback((field: IssueQuickEditField) => {
    switch (field) {
      case "status":
        return statusTriggerRef.current;
      case "priority":
        return priorityTriggerRef.current;
      case "assignee":
        return assigneeTriggerRef.current;
      default:
        return null;
    }
  }, []);
  // A selected row owns the strongest chrome. An open context menu and
  // keyboard focus share the next tier, while pointer hover is a
  // fallback. Keep this decision in one place so sticky cells and the row
  // do not drift. Context-open wins the tie so an unselected keyboard target
  // remains outline-focused while its menu is open.
  const visualState: IssueListRowVisualState = selected
    ? "selected"
    : contextOpen
      ? "context-open"
      : focused
        ? "focused"
        : "idle";

  useEffect(() => {
    if (
      focusRequest?.scope !== "list" ||
      focusRequest.target === "reorder-handle" ||
      (focusRequest.occurrenceKey ?? focusRequest.issueId) !==
        keyboardOccurrenceKey ||
      !rowRef.current
    ) {
      return;
    }
    rowRef.current.focus({ preventScroll: true });
    rowRef.current.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusRequest, keyboardOccurrenceKey]);

  useEffect(() => {
    const row = rowRef.current;
    const container =
      row?.closest('[data-testid="issue-list-scroll-container"]') ??
      row?.closest('[data-slot="table-container"]');
    if (
      (!focused && !contextOpen && !selected) ||
      !row ||
      !(container instanceof HTMLElement)
    ) {
      return;
    }

    const syncFocusChrome = () => {
      row.style.setProperty(
        "--reef-list-focus-width",
        `${container.clientWidth}px`,
      );
    };

    syncFocusChrome();
    window.addEventListener("resize", syncFocusChrome);

    return () => {
      window.removeEventListener("resize", syncFocusChrome);
      row.style.removeProperty("--reef-list-focus-width");
    };
  }, [contextOpen, focused, selected]);

  return (
    <IssueContextMenu
      issue={issue}
      vault={vault}
      currentLogin={currentLogin}
      planningCatalog={planningCatalog}
      assignees={assignees}
      onOpenChange={setContextOpen}
    >
      <TableRow
        ref={setRowRef}
        className={cn(
          "reef-issue-list-row group h-10 cursor-pointer transition-colors duration-150 focus-visible:outline-none",
          visualState === "idle" && onClick && "hover:bg-surface-hover",
          (visualState === "focused" || visualState === "selected") &&
            "bg-brand-fill/5 hover:bg-brand-fill/5",
          visualState === "selected" && "ring-1 ring-inset ring-brand-focus/30",
          visualState === "context-open" && "hover:bg-transparent",
          isFlashing && "reef-flash-row",
        )}
        tabIndex={focused || tabStopped ? 0 : -1}
        aria-selected={selected || undefined}
        onFocus={() => focusOccurrence("list", keyboardOccurrenceKey, issue.id)}
        onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
          if (
            event.defaultPrevented ||
            isInteractiveRowTarget(event.target) ||
            (event.key !== "Enter" && event.key !== " ")
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          onClick?.(issue.id);
        }}
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
        data-occurrence-key={keyboardOccurrenceKey}
        data-shortcut-surface="issue-list-row"
        data-keyboard-focused={focused ? "true" : undefined}
        data-context-open={contextOpen ? "true" : undefined}
      >
        <TableCell
          className={cn(issueListCellClass("select", visualState), "w-10 px-2")}
          style={issueListCellStyle(columns, "select", visualState)}
          data-column-key="select"
        >
          <IssueSelectionCheckbox
            checked={selected}
            disabled={selectionRunning}
            label={bulk("selectIssue", { id: issue.id })}
            className={cn(
              "transition-opacity group-hover:opacity-100 focus-within:opacity-100",
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
        {columns.includes("rank") && (
          <TableCell
            className={cn(issueListCellClass("rank", visualState), "pr-0")}
            style={issueListCellStyle(columns, "rank", visualState)}
            data-column-key="rank"
          >
            {sortable && reorderHint ? (
              <IssueListReorderHandle id={issue.id} label={reorderHint} />
            ) : (
              <span className="block size-8" aria-hidden="true" />
            )}
          </TableCell>
        )}
        {/* ID */}
        <TableCell
          className={cn(
            issueListCellClass("id", visualState),
            "relative font-mono text-xs text-muted-foreground",
          )}
          style={issueListCellStyle(columns, "id", visualState)}
          data-column-key="id"
        >
          {issue.id}
          <IssueQuickEditAnchor
            scope="list"
            issue={issue}
            vault={vault}
            occurrenceKey={keyboardOccurrenceKey}
            getAnchorElement={getQuickEditAnchor}
          />
        </TableCell>

        {/* Type */}
        <TableCell
          className={issueListCellClass("type", visualState)}
          style={issueListCellStyle(columns, "type", visualState)}
          data-column-key="type"
        >
          <TypePill type={issue.issue_type} variant="list" />
        </TableCell>

        {/* Title */}
        <TableCell
          className={issueListCellClass("title", visualState)}
          style={issueListCellStyle(columns, "title", visualState)}
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
          className={issueListCellClass("status", visualState)}
          style={issueListCellStyle(columns, "status", visualState)}
          data-column-key="status"
        >
          <IssueInlineEditTrigger
            scope="list"
            field="status"
            issueId={issue.id}
            vault={vault}
            occurrenceKey={keyboardOccurrenceKey}
            label={fieldNames.status}
            anchorRef={statusTriggerRef}
          >
            <StatusBadge status={issue.status} />
          </IssueInlineEditTrigger>
        </TableCell>

        {/* Priority */}
        <TableCell
          className={issueListCellClass("priority", visualState)}
          style={issueListCellStyle(columns, "priority", visualState)}
          data-column-key="priority"
        >
          <IssueInlineEditTrigger
            scope="list"
            field="priority"
            issueId={issue.id}
            vault={vault}
            occurrenceKey={keyboardOccurrenceKey}
            label={fieldNames.priority}
            anchorRef={priorityTriggerRef}
          >
            {issue.priority ? (
              <PriorityBadge priority={issue.priority} />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </IssueInlineEditTrigger>
        </TableCell>

        {/* Assignee */}
        <TableCell
          className={cn(issueListCellClass("assignee", visualState), "text-sm")}
          style={issueListCellStyle(columns, "assignee", visualState)}
          data-column-key="assignee"
        >
          <IssueInlineEditTrigger
            scope="list"
            field="assignee"
            issueId={issue.id}
            vault={vault}
            occurrenceKey={keyboardOccurrenceKey}
            label={fieldNames.assignee}
            anchorRef={assigneeTriggerRef}
          >
            {issue.assigned_to ? (
              <PersonChip
                identityKey={issue.assigned_to}
                name={
                  issue.assigned_to
                    ? assigneeNames?.[issue.assigned_to]
                    : undefined
                }
                size="sm"
                tone={personToneFor(issue.assigned_to, currentLogin)}
              />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </IssueInlineEditTrigger>
        </TableCell>

        {/* Start */}
        {columns.includes("start") && (
          <TableCell
            className="h-10 min-w-0 px-3 py-0 text-xs whitespace-nowrap text-muted-foreground"
            style={issueListCellStyle(columns, "start", visualState)}
            data-column-key="start"
          >
            <DateDisplay date={issue.start_date} emptyText="—" />
          </TableCell>
        )}

        {/* Sprint */}
        {columns.includes("sprint") && (
          <TableCell
            className="h-10 min-w-0 px-3 py-0 text-xs text-muted-foreground"
            style={issueListCellStyle(columns, "sprint", visualState)}
            data-column-key="sprint"
          >
            {findPlanningName(planningCatalog, "sprints", issue.sprint_id) ??
              "—"}
          </TableCell>
        )}

        {/* Milestone */}
        {columns.includes("milestone") && (
          <TableCell
            className="h-10 min-w-0 px-3 py-0 text-xs text-muted-foreground"
            style={issueListCellStyle(columns, "milestone", visualState)}
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
            style={issueListCellStyle(columns, "release", visualState)}
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
            style={issueListCellStyle(columns, "due", visualState)}
            data-column-key="due"
          >
            <DateDisplay date={issue.due_date} emptyText="—" />
          </TableCell>
        )}

        {/* Updated */}
        {columns.includes("updated") && (
          <TableCell
            className="h-10 min-w-0 px-3 py-0 text-xs whitespace-nowrap text-muted-foreground"
            style={issueListCellStyle(columns, "updated", visualState)}
            data-column-key="updated"
          >
            {formatRelativeTime(issue.updated_at, locale)}
          </TableCell>
        )}
      </TableRow>
    </IssueContextMenu>
  );
});
