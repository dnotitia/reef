"use client";

import { AssigneeCombobox } from "@/components/AssigneeCombobox";
import { EnumSelectField } from "@/components/fields/EnumSelectField";
import { LabelChipInput } from "@/components/ui/label-chip-input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PriorityBadge } from "@/components/ui/priority-dot";
import { StatusBadge } from "@/components/ui/status-icon";
import {
  kanbanToastId,
  notifyRetryableError,
} from "@/components/ui/toastFeedback";
import { useUpdateIssue } from "@/features/issues/hooks/mutations/useUpdateIssue";
import { buildStatusPatch } from "@/features/issues/lib/statusPatch";
import { useFlashStore } from "@/features/issues/stores/useFlashStore";
import {
  type IssueKeyboardScope,
  type IssueQuickEditField,
  useIssueKeyboardStore,
} from "@/features/issues/stores/useIssueKeyboardStore";
import {
  useEnrichmentEmptyLabels,
  useFieldNameLabels,
} from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type {
  ClosedReason,
  IssueListItem,
  IssueUpdatePatch,
  Priority,
  Status,
} from "@reef/core";
import {
  NO_SELECTION,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
} from "@reef/core/fields";
import { useTranslations } from "next-intl";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { CloseIssueDialog } from "../detail/CloseIssueDialog";

interface IssueQuickEditAnchorProps {
  scope: IssueKeyboardScope;
  issue: IssueListItem;
  vault: string;
  occurrenceKey?: string;
  className?: string;
  /** Limit the fields exposed by a surface (Backlog intentionally omits labels). */
  allowedFields?: readonly IssueQuickEditField[];
  /** Resolve a List field to the actual focusable trigger that opened it. */
  getAnchorElement?: (field: IssueQuickEditField) => HTMLElement | null;
}

const renderStatusOption = (status: Status) => <StatusBadge status={status} />;
const renderPriorityOption = (priority: Priority) => (
  <PriorityBadge priority={priority} />
);
const COMPACT_QUICK_EDIT_WIDTH = "w-48";
const DEFAULT_QUICK_EDIT_WIDTH = "w-56";

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function IssueQuickEditAnchor({
  scope,
  issue,
  vault,
  occurrenceKey,
  className,
  allowedFields,
  getAnchorElement,
}: IssueQuickEditAnchorProps) {
  const request = useIssueKeyboardStore((state) => state.quickEditRequest);
  const closeQuickEdit = useIssueKeyboardStore((state) => state.closeQuickEdit);
  const mutation = useUpdateIssue();
  const flashIssue = useFlashStore((state) => state.flashIssue);
  const fieldNames = useFieldNameLabels();
  const empty = useEnrichmentEmptyLabels();
  const common = useTranslations("common");
  const board = useTranslations("board");
  const [pendingClose, setPendingClose] = useState(false);
  const [anchorPosition, setAnchorPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const anchorOriginRef = useRef<HTMLSpanElement>(null);
  const viewportSizeRef = useRef<{ width: number; height: number } | null>(
    null,
  );
  const suppressResizeCloseRef = useRef(false);
  const clearResizeSuppressionRef = useRef<number | null>(null);

  const resolvedOccurrenceKey = occurrenceKey ?? issue.id;
  const field =
    request?.scope === scope &&
    request.issueId === issue.id &&
    (request.occurrenceKey ?? request.issueId) === resolvedOccurrenceKey &&
    (allowedFields === undefined || allowedFields.includes(request.field))
      ? request.field
      : null;
  const anchorWidth =
    field === "status" || field === "priority"
      ? COMPACT_QUICK_EDIT_WIDTH
      : DEFAULT_QUICK_EDIT_WIDTH;

  const updateAnchorPosition = useCallback(() => {
    if (field === null) return;
    const anchor = getAnchorElement
      ? field === "labels"
        ? anchorOriginRef.current?.parentElement
        : getAnchorElement(field)
      : anchorOriginRef.current?.parentElement;
    if (!anchor) {
      setAnchorPosition(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    setAnchorPosition({
      left: rect.left + (getAnchorElement && field !== "labels" ? 0 : 8),
      top: rect.top + rect.height / 2,
    });
  }, [field, getAnchorElement]);

  const noteViewportResize = useCallback((force = false) => {
    if (typeof window === "undefined") return false;
    const nextSize = { width: window.innerWidth, height: window.innerHeight };
    const previousSize = viewportSizeRef.current;
    viewportSizeRef.current = nextSize;
    const changed =
      previousSize !== null &&
      (previousSize.width !== nextSize.width ||
        previousSize.height !== nextSize.height);
    if (!changed && !force) return false;

    suppressResizeCloseRef.current = true;
    if (clearResizeSuppressionRef.current !== null) {
      window.clearTimeout(clearResizeSuppressionRef.current);
    }
    clearResizeSuppressionRef.current = window.setTimeout(() => {
      suppressResizeCloseRef.current = false;
      clearResizeSuppressionRef.current = null;
    }, 100);
    return true;
  }, []);

  const handleResize = useCallback(() => {
    // Radix Select closes its controlled content on resize. The quick editor
    // must remain open so its portal can follow the active trigger. The close
    // callback can run before or after this listener, so track the viewport
    // size as well as the event ordering rather than relying on one microtask.
    noteViewportResize(true);
    updateAnchorPosition();
  }, [noteViewportResize, updateAnchorPosition]);

  useLayoutEffect(() => {
    if (field === null) {
      setAnchorPosition(null);
      return;
    }

    if (typeof window !== "undefined") {
      viewportSizeRef.current = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
    }
    updateAnchorPosition();
    window.addEventListener("resize", handleResize, true);
    window.addEventListener("scroll", updateAnchorPosition, true);
    return () => {
      window.removeEventListener("resize", handleResize, true);
      window.removeEventListener("scroll", updateAnchorPosition, true);
      if (clearResizeSuppressionRef.current !== null) {
        window.clearTimeout(clearResizeSuppressionRef.current);
        clearResizeSuppressionRef.current = null;
      }
      suppressResizeCloseRef.current = false;
    };
  }, [field, handleResize, updateAnchorPosition]);

  function commitPatch(patch: IssueUpdatePatch) {
    mutation.mutateAsync({ id: issue.id, vault, patch }).then(
      () => {
        toast.dismiss(kanbanToastId(issue.id));
        flashIssue(issue.id);
      },
      (err: unknown) => {
        notifyRetryableError({
          id: kanbanToastId(issue.id),
          title:
            err instanceof Error && err.message
              ? err.message
              : board("updateErrorTitle"),
          description: board("updateErrorDescription"),
          onRetry: () => commitPatch(patch),
        });
      },
    );
  }

  function closeOpenField(open: boolean) {
    if (!open) {
      if (noteViewportResize() || suppressResizeCloseRef.current) {
        suppressResizeCloseRef.current = false;
        return;
      }
      closeQuickEdit();
    }
  }

  function commitStatus(next: Status) {
    if (next === issue.status) {
      closeQuickEdit();
      return;
    }
    if (next === "closed" && issue.status !== "closed") {
      closeQuickEdit();
      setPendingClose(true);
      return;
    }
    closeQuickEdit();
    commitPatch(buildStatusPatch(issue, next));
  }

  function confirmClose(reason: ClosedReason) {
    setPendingClose(false);
    commitPatch(buildStatusPatch(issue, "closed", undefined, reason));
  }

  const anchor =
    field === null ? null : (
      <div
        className={cn(
          "pointer-events-auto fixed z-50 -translate-y-1/2",
          anchorWidth,
          className,
        )}
        style={{
          left: anchorPosition?.left,
          top: anchorPosition?.top,
          visibility: anchorPosition ? "visible" : "hidden",
        }}
        data-testid="issue-quick-edit-anchor"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {field === "status" && (
          <EnumSelectField
            value={issue.status}
            onValueChange={(value) => commitStatus(value as Status)}
            options={STATUS_OPTIONS}
            renderItem={renderStatusOption}
            placeholder={fieldNames.status}
            testId="issue-quick-edit-status"
            open
            onOpenChange={closeOpenField}
            disabled={mutation.isPending}
            triggerClassName="bg-popover shadow-lg shadow-foreground/10"
            contentClassName={COMPACT_QUICK_EDIT_WIDTH}
          />
        )}

        {field === "priority" && (
          <EnumSelectField
            value={issue.priority ?? NO_SELECTION}
            onValueChange={(value) => {
              const next = value === NO_SELECTION ? null : (value as Priority);
              closeQuickEdit();
              if (next !== (issue.priority ?? null)) {
                commitPatch({ priority: next });
              }
            }}
            options={PRIORITY_OPTIONS}
            renderItem={renderPriorityOption}
            placeholder={empty.noPriority}
            noneOption={{ value: NO_SELECTION, label: empty.noPriority }}
            testId="issue-quick-edit-priority"
            open
            onOpenChange={closeOpenField}
            disabled={mutation.isPending}
            triggerClassName="bg-popover shadow-lg shadow-foreground/10"
            contentClassName={COMPACT_QUICK_EDIT_WIDTH}
          />
        )}

        {field === "assignee" && (
          <AssigneeCombobox
            value={issue.assigned_to ?? ""}
            onChange={(value) => {
              closeQuickEdit();
              if (value !== (issue.assigned_to ?? "")) {
                commitPatch({ assigned_to: value || null });
              }
            }}
            vault={vault}
            label={fieldNames.assignee}
            emptyLabel={empty.unassigned}
            align="start"
            panelClassName="min-w-64"
            open
            onOpenChange={closeOpenField}
            disabled={mutation.isPending}
          />
        )}

        {field === "labels" && (
          <Popover open onOpenChange={closeOpenField}>
            <PopoverTrigger className="h-8 w-full justify-start rounded-md border border-border bg-popover px-2.5 text-[13px] text-foreground shadow-lg shadow-foreground/10">
              {fieldNames.labels}
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2">
              <LabelChipInput
                value={issue.labels ?? []}
                onChange={(next) => {
                  if (!sameStringArray(next, issue.labels ?? [])) {
                    commitPatch({ labels: next });
                  }
                }}
                placeholder={common("addLabelPlaceholder")}
                data-testid="issue-quick-edit-labels"
                autoFocus
                disabled={mutation.isPending}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
    );

  // The interactive panel lives under body so sticky table cells cannot clip
  // its hit area. When supplied, its position follows the active trigger.
  const renderedAnchor =
    anchor === null
      ? null
      : typeof document === "undefined"
        ? anchor
        : createPortal(anchor, document.body);

  return (
    <>
      <span ref={anchorOriginRef} className="hidden" aria-hidden="true" />
      {renderedAnchor}
      <CloseIssueDialog
        open={pendingClose}
        issueId={issue.id}
        disabled={mutation.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingClose(false);
        }}
        onConfirm={confirmClose}
      />
    </>
  );
}
