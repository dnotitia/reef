"use client";

import { personToneFor } from "@/components/fields/PersonAvatar";
import { PersonChip } from "@/components/fields/PersonChip";
import { TypePill } from "@/components/fields/TypePill";
import { PriorityBadge } from "@/components/ui/priority-dot";
import { StatusBadge } from "@/components/ui/status-icon";
import { TableCell, TableRow } from "@/components/ui/table";
import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import { IssueInlineEditTrigger } from "@/features/issues/components/quick-edit/IssueInlineEditTrigger";
import { IssueQuickEditAnchor } from "@/features/issues/components/quick-edit/IssueQuickEditAnchor";
import { IssueSelectionCheckbox } from "@/features/issues/components/shared/IssueSelectionCheckbox";
import {
  IssueReorderStatus,
  type IssueReorderSurfaceState,
} from "@/features/issues/components/shared/IssueReorderFeedback";
import {
  ISSUE_TABLE_COLUMN_WIDTHS,
  type IssueTableColumnKey,
} from "@/features/issues/components/shared/issueTableContract";
import { formatRelativeTime } from "@/features/issues/lib/formatRelativeTime";
import { useIssueReorderFlash } from "@/features/issues/stores/useFlashStore";
import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import { useFieldNameLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { IssueListItem } from "@reef/core";
import { GripVertical } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  type KeyboardEvent,
  type MouseEvent,
  memo,
  useCallback,
  useEffect,
  useRef,
} from "react";

interface BacklogRowProps {
  issue: IssueListItem;
  vault: string;
  href: string;
  logicalIds: readonly string[];
  onOpen: (id: string) => void;
  /**
   * Rank-order mode (REEF-129): the row is drag-reorderable by its grip
   * handle. When false (a user sort is active) the grip is inert and the row is
   * a static triage row.
   */
  sortable?: boolean;
  reorderHint: string;
  reorderState?: IssueReorderSurfaceState | null;
}

const BACKLOG_QUICK_EDIT_FIELDS = ["status", "priority", "assignee"] as const;

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

function backlogCellClass(column: IssueTableColumnKey) {
  return cn(
    "h-10 min-w-0 px-3 py-0 align-middle",
    column === "title" && "min-w-[15rem]",
  );
}

function backlogCellStyle(column: IssueTableColumnKey) {
  return {
    ...(column === "title"
      ? { minWidth: ISSUE_TABLE_COLUMN_WIDTHS.title }
      : { width: ISSUE_TABLE_COLUMN_WIDTHS[column] }),
  };
}

/**
 * Slim triage row for the backlog view: Rank · ID · Type · Title · Status ·
 * Priority · Assignee · Updated. In rank-order mode the leading grip is a
 * drag handle; the triage fields use the shared inline quick-edit triggers.
 * Clicking the row opens the issue; the grip and field triggers stop
 * propagation so neither navigates.
 */
export const BacklogRow = memo(function BacklogRow({
  issue,
  vault,
  href,
  logicalIds,
  onOpen,
  sortable = false,
  reorderHint,
  reorderState = null,
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
  const t = useTranslations("issues.backlog");
  const bulk = useTranslations("issues.bulk");
  const fieldNames = useFieldNameLabels();
  const focused = useIssueKeyboardStore(
    (state) => state.focusedIssueId.backlog === issue.id,
  );
  const tabStopped = useIssueKeyboardStore(
    (state) => state.tabStopIssueId.backlog === issue.id,
  );
  const focusRequest = useIssueKeyboardStore((state) => state.focusRequest);
  const focusIssue = useIssueKeyboardStore((state) => state.focusIssue);
  const reorderSuccess = useIssueReorderFlash(vault, issue.id);
  const surfaceReorderState =
    reorderState ?? (reorderSuccess ? "success" : null);
  const selected = useIssueSelectionStore((state) =>
    state.selectedIds.has(issue.id),
  );
  const selectionRunning = useIssueSelectionStore((state) => state.running);
  const rowRef = useRef<HTMLTableRowElement | null>(null);
  const statusTriggerRef = useRef<HTMLButtonElement>(null);
  const priorityTriggerRef = useRef<HTMLButtonElement>(null);
  const assigneeTriggerRef = useRef<HTMLButtonElement>(null);
  const getQuickEditAnchor = useCallback(
    (field: "status" | "priority" | "assignee" | "labels") => {
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
    },
    [],
  );
  const setRowRef = useCallback(
    (node: HTMLTableRowElement | null) => {
      rowRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef],
  );

  useEffect(() => {
    if (
      focusRequest?.scope !== "backlog" ||
      focusRequest.issueId !== issue.id ||
      !rowRef.current
    ) {
      return;
    }
    rowRef.current.focus({ preventScroll: true });
    rowRef.current.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusRequest, issue.id]);

  return (
    <TableRow
      ref={setRowRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group h-10 cursor-pointer transition-colors duration-150 focus-visible:outline-none hover:bg-surface-hover",
        focused && "bg-brand-fill/5",
        selected && "bg-brand-fill/5 ring-1 ring-inset ring-brand-focus/30",
        reorderSuccess && "reef-flash-row",
        reorderSuccess && "reef-reorder-success-row",
        // Lift the dragged row out of the flow with the board's drag treatment.
        isDragging &&
          "relative z-10 bg-surface-elevated shadow-md ring-1 ring-brand-focus/40",
      )}
      tabIndex={focused || tabStopped ? 0 : -1}
      aria-busy={surfaceReorderState === "pending" ? true : undefined}
      aria-selected={selected || undefined}
      onFocus={() => focusIssue("backlog", issue.id)}
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
        onOpen(issue.id);
      }}
      onClick={(event: MouseEvent<HTMLTableRowElement>) => {
        if (event.shiftKey) {
          event.preventDefault();
          useIssueSelectionStore.getState().extendRange(issue.id, logicalIds);
          return;
        }
        onOpen(issue.id);
      }}
      data-testid="backlog-row"
      data-issue-id={issue.id}
      data-shortcut-surface="issue-backlog-row"
      data-keyboard-focused={focused ? "true" : undefined}
      data-reorder-state={surfaceReorderState ?? undefined}
    >
      <TableCell
        className={cn(backlogCellClass("select"), "w-10 px-2")}
        style={backlogCellStyle("select")}
        data-column-key="select"
      >
        <IssueSelectionCheckbox
          checked={selected}
          disabled={selectionRunning}
          label={bulk("selectIssue", { id: issue.id })}
          className="transition-opacity group-hover:opacity-100 focus-within:opacity-100"
          testId="backlog-row-checkbox"
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

      {/* The empty button-sized span keeps the Rank column stable when sorting
          disables reordering. */}
      <TableCell
        className={cn(backlogCellClass("rank"), "pr-0 text-muted-foreground")}
        style={backlogCellStyle("rank")}
        data-column-key="rank"
      >
        {sortable ? (
          <button
            type="button"
            aria-label={t("reorderGrip", { id: issue.id })}
            title={reorderHint}
            data-testid={`backlog-grip-${issue.id}`}
            className="flex h-8 w-8 cursor-grab touch-none items-center justify-center rounded-sm opacity-40 transition-opacity duration-150 group-hover:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40 active:cursor-grabbing"
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

      {/* ID */}
      <TableCell
        className={cn(
          backlogCellClass("id"),
          "type-list-id text-muted-foreground",
        )}
        style={backlogCellStyle("id")}
        data-column-key="id"
      >
        <Link
          href={href}
          className="rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
          onClick={(event) => event.stopPropagation()}
        >
          {issue.id}
        </Link>
        <IssueQuickEditAnchor
          scope="backlog"
          issue={issue}
          vault={vault}
          allowedFields={BACKLOG_QUICK_EDIT_FIELDS}
          getAnchorElement={getQuickEditAnchor}
        />
      </TableCell>

      {/* Type */}
      <TableCell
        className={backlogCellClass("type")}
        style={backlogCellStyle("type")}
        data-column-key="type"
      >
        <TypePill type={issue.issue_type} variant="list" />
      </TableCell>

      {/* Title */}
      <TableCell
        className={backlogCellClass("title")}
        style={backlogCellStyle("title")}
        data-column-key="title"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Link
            href={href}
            className="block min-w-0 flex-1 truncate rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
            onClick={(event) => event.stopPropagation()}
          >
            {issue.title}
          </Link>
          {surfaceReorderState && surfaceReorderState !== "success" && (
            <IssueReorderStatus state={surfaceReorderState} />
          )}
        </span>
      </TableCell>

      {/* Status — the shared quick-edit trigger stops row navigation. */}
      <TableCell
        className={backlogCellClass("status")}
        style={backlogCellStyle("status")}
        data-column-key="status"
      >
        <IssueInlineEditTrigger
          scope="backlog"
          field="status"
          issueId={issue.id}
          vault={vault}
          occurrenceKey={issue.id}
          label={fieldNames.status}
          anchorRef={statusTriggerRef}
        >
          <StatusBadge status={issue.status} />
        </IssueInlineEditTrigger>
      </TableCell>

      {/* Priority */}
      <TableCell
        className={backlogCellClass("priority")}
        style={backlogCellStyle("priority")}
        data-column-key="priority"
      >
        <IssueInlineEditTrigger
          scope="backlog"
          field="priority"
          issueId={issue.id}
          vault={vault}
          occurrenceKey={issue.id}
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
        className={cn(backlogCellClass("assignee"), "text-sm")}
        style={backlogCellStyle("assignee")}
        data-column-key="assignee"
      >
        <IssueInlineEditTrigger
          scope="backlog"
          field="assignee"
          issueId={issue.id}
          vault={vault}
          occurrenceKey={issue.id}
          label={fieldNames.assignee}
          anchorRef={assigneeTriggerRef}
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
        </IssueInlineEditTrigger>
      </TableCell>

      {/* Updated */}
      <TableCell
        className={cn(
          backlogCellClass("updated"),
          "whitespace-nowrap text-xs text-muted-foreground",
        )}
        style={backlogCellStyle("updated")}
        data-column-key="updated"
      >
        {formatRelativeTime(issue.updated_at, locale)}
      </TableCell>
    </TableRow>
  );
});
