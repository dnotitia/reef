"use client";

import {
  type IssueKeyboardScope,
  type IssueQuickEditField,
  useIssueKeyboardStore,
} from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueUpdateState } from "@/features/issues/hooks/mutations/useUpdateIssue";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";

interface IssueInlineEditTriggerProps {
  scope: IssueKeyboardScope;
  field: IssueQuickEditField;
  issueId: string;
  vault: string;
  occurrenceKey: string;
  label: string;
  children: ReactNode;
  anchorRef?: Ref<HTMLButtonElement>;
}

const QUICK_EDIT_PATCH_FIELDS = {
  status: "status",
  priority: "priority",
  assignee: "assigned_to",
  labels: "labels",
} as const;

/**
 * Shared field trigger for the List and Backlog quick-edit surfaces. The
 * trigger owns keyboard/focus intent; mutation and the portaled editor
 * remain in IssueQuickEditAnchor so every surface shares one save path.
 */
export function IssueInlineEditTrigger({
  scope,
  field,
  issueId,
  vault,
  occurrenceKey,
  label,
  children,
  anchorRef,
}: IssueInlineEditTriggerProps) {
  const update = useIssueUpdateState(vault, issueId);
  const quickEdit = useTranslations("issues.quickEdit");
  const fieldUpdate = update.fields.includes(QUICK_EDIT_PATCH_FIELDS[field]);
  const fieldPending = update.status === "pending" && fieldUpdate;
  const fieldMessage =
    fieldUpdate && update.status === "pending"
      ? quickEdit("fieldUpdating", { field: label })
      : fieldUpdate && update.status === "success"
        ? quickEdit("fieldUpdated", { field: label })
        : fieldUpdate && update.status === "error"
          ? quickEdit("fieldUpdateFailed", { field: label })
          : "";
  function requestEdit() {
    const keyboard = useIssueKeyboardStore.getState();
    keyboard.focusOccurrence(scope, occurrenceKey, issueId);
    keyboard.requestQuickEdit(scope, field, { requestDomFocus: false });
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={update.status === "pending"}
        className="inline-flex h-full max-w-full min-w-0 items-center rounded-sm text-left outline-none transition-colors duration-150 hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-brand-focus/40"
        aria-label={label}
        aria-busy={fieldPending || undefined}
        data-testid={`issue-inline-edit-${field}`}
        onClick={(event) => {
          event.stopPropagation();
          requestEdit();
        }}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          event.stopPropagation();
          requestEdit();
        }}
      >
        {children}
        {fieldPending && (
          <LoaderCircle
            className="ml-1.5 size-3.5 shrink-0 motion-safe:animate-spin"
            aria-hidden="true"
          />
        )}
      </button>
      {fieldMessage && (
        <span
          role="status"
          aria-live="polite"
          className="sr-only"
          data-issue-update-announcement
        >
          {fieldMessage}
        </span>
      )}
    </>
  );
}
