import { AlertTriangle, Check } from "lucide-react";
import { memo } from "react";

/**
 * Auto-save indicator state. `saved` is the transient confirmation shown briefly
 * after a successful write before fading back to `idle`.
 */
export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Header save-status chip. A memo so it re-renders when `status` (or the
 * stable `onRetry`) changes — not on every keystroke that re-renders the
 * surrounding detail panel.
 *
 * The `error` state shares its Retry with the failure toast (same
 * `retryLastCommit`), so resolving either clears both.
 */
function IssueSaveStatusComponent({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  if (status === "saving") {
    return (
      <span
        data-testid="issue-save-status"
        className="text-[11px] text-muted-foreground"
      >
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span
        data-testid="issue-save-status"
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
      >
        <Check className="h-3 w-3" aria-hidden="true" />
        Saved
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        data-testid="issue-save-status"
        className="inline-flex items-center gap-1 text-[11px] text-destructive"
      >
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        Not saved
        <span aria-hidden="true">·</span>
        <button
          type="button"
          data-testid="issue-save-retry"
          onClick={onRetry}
          className="rounded-sm font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
        >
          Retry
        </button>
      </span>
    );
  }
  return null;
}

export const IssueSaveStatus = memo(IssueSaveStatusComponent);
