"use client";

import {
  type IssueKeyboardScope,
  type IssueQuickEditField,
  useIssueKeyboardStore,
} from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueStatusUpdateState } from "@/features/issues/hooks/mutations/useUpdateIssue";
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
  const statusUpdate = useIssueStatusUpdateState(vault, issueId);
  const quickEdit = useTranslations("issues.quickEdit");
  const statusMessage =
    field !== "status"
      ? ""
      : statusUpdate.status === "pending"
        ? quickEdit("statusUpdating")
        : statusUpdate.status === "success"
          ? quickEdit("statusUpdated")
          : statusUpdate.status === "error"
            ? quickEdit("statusUpdateFailed")
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
        disabled={field === "status" && statusUpdate.status === "pending"}
        className="inline-flex h-full max-w-full min-w-0 items-center rounded-sm text-left outline-none transition-colors duration-150 hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-brand-focus/40"
        aria-label={label}
        aria-busy={
          field === "status" && statusUpdate.status === "pending"
            ? true
            : undefined
        }
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
        {field === "status" && statusUpdate.status === "pending" && (
          <LoaderCircle
            className="ml-1.5 size-3.5 shrink-0 animate-spin"
            aria-hidden="true"
          />
        )}
      </button>
      {field === "status" && statusMessage && (
        <span
          role="status"
          aria-live="polite"
          className="sr-only"
          data-status-update-announcement
        >
          {statusMessage}
        </span>
      )}
    </>
  );
}
