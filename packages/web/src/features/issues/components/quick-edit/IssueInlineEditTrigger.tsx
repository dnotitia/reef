"use client";

import {
  type IssueKeyboardScope,
  type IssueQuickEditField,
  useIssueKeyboardStore,
} from "@/features/issues/stores/useIssueKeyboardStore";
import type { KeyboardEvent, ReactNode, Ref } from "react";

interface IssueInlineEditTriggerProps {
  scope: IssueKeyboardScope;
  field: IssueQuickEditField;
  issueId: string;
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
  occurrenceKey,
  label,
  children,
  anchorRef,
}: IssueInlineEditTriggerProps) {
  function requestEdit() {
    const keyboard = useIssueKeyboardStore.getState();
    keyboard.focusOccurrence(scope, occurrenceKey, issueId);
    keyboard.requestQuickEdit(scope, field, { requestDomFocus: false });
  }

  return (
    <button
      ref={anchorRef}
      type="button"
      className="inline-flex h-full max-w-full min-w-0 items-center rounded-sm text-left outline-none transition-colors duration-150 hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-brand/40"
      aria-label={label}
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
    </button>
  );
}
