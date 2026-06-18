"use client";

import { AlertTriangle, Check, RotateCw, Undo2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Toast feedback helpers — the three mutation-feedback shapes reef emits, kept
 * distinct on one channel (bottom-right <Toaster>):
 *
 *  1. retryable error — optimistic/background write failed (kanban move,
 *     auto-save). Destructive, never auto-dismisses, offers Retry.
 *  2. undoable success — a reversible single action (archive ↔ unarchive).
 *     Neutral, offers Undo.
 *
 * Form-submit errors render inline (not here); single non-reversible successes
 * use plain `toast.success` directly.
 *
 * "Quiet Utility": color carries meaning only (error → destructive tint;
 * success/info stay neutral). Hierarchy is icon → title → description → action.
 * Icons are a single lucide family (Check / AlertTriangle / RotateCw / Undo2).
 * Actions use sonner's built-in `action` API so keyboard/focus/aria are
 * preserved — no custom JSX action component.
 */

/** Stable toast id for an issue's inline auto-save feedback. */
export function saveToastId(issueId: string): string {
  return `save:${issueId}`;
}

/** Stable toast id for a kanban board status-move write. */
export function kanbanToastId(issueId: string): string {
  return `kanban:${issueId}`;
}

/**
 * Destructive-outline classes for an error toast's action button. The global
 * <Toaster> `actionButton` is neutral (bg-primary) for success/info; error
 * toasts override it per-call so "Retry" reads as a cautious secondary
 * affordance rather than a primary CTA. Web-only color token — Tailwind classes
 * never live in core. `!` important beats the non-important global classes.
 */
export const ERROR_ACTION_BUTTON_CLASS =
  "group-[.toast]:!border group-[.toast]:!border-destructive/30 group-[.toast]:!bg-transparent group-[.toast]:!text-destructive group-[.toast]:hover:!bg-destructive/10";

export interface RetryableErrorOptions {
  /** Stable id so retries/successes morph this toast in place. */
  id: string;
  title: string;
  description?: string;
  /**
   * Re-runs the failed write. Pass a callback that reads current state at click
   * time, because this toast can outlive many renders.
   */
  onRetry: () => void;
}

/**
 * Destructive toast for an optimistic/background write that failed. Never
 * auto-dismisses (`duration: Infinity`) — the user must act. "Retry" morphs the
 * toast to a loading state under the same `id` and invokes `onRetry`; the caller
 * re-emits a success (or another retryable error) under that id so the toast
 * updates in place.
 */
export function notifyRetryableError({
  id,
  title,
  description,
  onRetry,
}: RetryableErrorOptions): void {
  toast.error(title, {
    id,
    description,
    icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
    duration: Number.POSITIVE_INFINITY,
    action: {
      label: (
        <span className="inline-flex items-center gap-1">
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </span>
      ),
      onClick: () => {
        // Morph to loading under the same id; the caller re-emits success/error
        // so the toast updates in place rather than stacking a new one.
        toast.loading("Retrying…", { id });
        onRetry();
      },
    },
    classNames: { actionButton: ERROR_ACTION_BUTTON_CLASS },
  });
}

export interface ConflictNoticeOptions {
  /** Stable id (the issue's save toast id) so a later successful save morphs it. */
  id: string;
  title: string;
  description?: string;
}

/**
 * Non-retry warning toast for a save rejected by a concurrency conflict
 * (document OCC, REEF-227). Unlike `notifyRetryableError` it offers no Retry:
 * blindly resubmitting the stale edit would overwrite the change that won once
 * the conflict refetch advances the base. The caller refetches so the form
 * reconciles to the latest; the user re-applies the edit consciously. Persists
 * until dismissed or replaced by the next save under the same id.
 */
export function notifyConflict({
  id,
  title,
  description,
}: ConflictNoticeOptions): void {
  toast.warning(title, {
    id,
    description,
    icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
    duration: Number.POSITIVE_INFINITY,
  });
}

export interface UndoableSuccessOptions {
  id: string;
  message: string;
  /** Reverses the action. Invoked once, then the toast is dismissed. */
  onUndo: () => void;
}

/**
 * Neutral success toast with an "Undo" action. Use only when the action is
 * genuinely reversible (e.g. archive ↔ unarchive). Clicking Undo invokes
 * `onUndo` and dismisses the toast.
 */
export function notifyUndoableSuccess({
  id,
  message,
  onUndo,
}: UndoableSuccessOptions): void {
  toast.success(message, {
    id,
    icon: <Check className="h-4 w-4" aria-hidden="true" />,
    action: {
      label: (
        <span className="inline-flex items-center gap-1">
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          Undo
        </span>
      ),
      onClick: () => {
        toast.dismiss(id);
        onUndo();
      },
    },
  });
}
