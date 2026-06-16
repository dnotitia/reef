"use client";

import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, Sparkles, X } from "lucide-react";

export interface EnrichmentReviewBarProps {
  pending: number;
  accepted: number;
  onAcceptAll: () => void;
  onDismissAll: () => void;
  /** Enrichment request in flight — shows a global progress strip. */
  isLoading?: boolean;
  /** Result arrived with zero suggestions. */
  isEmpty?: boolean;
  /** PM-vocabulary error message from the enrich mutation. */
  error?: string;
  onRetry?: () => void;
  /** Dismiss the final empty/error banner so it stops lingering. */
  onClose?: () => void;
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Dismiss enrichment notice"
      data-testid="enrichment-review-close"
      className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

/**
 * Sticky strip at the top of the New Issue dialog body. Hosts the global
 * states that have no single field to attach to: loading (we don't yet know
 * which fields will be suggested), error, empty, and the review progress with
 * Apply all / Dismiss all. Mounted by the dialog whenever any of these apply.
 */
export function EnrichmentReviewBar({
  pending,
  accepted,
  onAcceptAll,
  onDismissAll,
  isLoading,
  isEmpty,
  error,
  onRetry,
  onClose,
}: EnrichmentReviewBarProps) {
  const base =
    "sticky top-0 z-10 -mx-1 mb-1 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-ai-border bg-ai-subtle/60 px-3 py-2 backdrop-blur";

  if (isLoading) {
    return (
      <div className={base} data-testid="enrichment-review-loading">
        <Loader2 className="h-4 w-4 animate-spin text-ai-subtle-foreground" />
        <span className="text-xs text-ai-subtle-foreground">
          Analyzing fields…
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="sticky top-0 z-10 -mx-1 mb-1 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
        data-testid="enrichment-review-error"
      >
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="flex-1 text-xs text-muted-foreground">
          <p>{error}</p>
          {onRetry && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 h-7 px-2 text-xs"
              onClick={onRetry}
            >
              Try again
            </Button>
          )}
        </div>
        {onClose && <CloseButton onClose={onClose} />}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className={base} data-testid="enrichment-review-empty">
        <Sparkles className="h-4 w-4 text-ai-subtle-foreground" />
        <span className="text-xs text-muted-foreground">
          No additional suggestions.
        </span>
        {onClose && <CloseButton onClose={onClose} />}
      </div>
    );
  }

  return (
    <div className={base} data-testid="enrichment-review-bar">
      <Sparkles
        className="h-4 w-4 text-ai-subtle-foreground"
        aria-hidden="true"
      />
      <span className="text-xs text-ai-subtle-foreground">
        <span className="font-mono font-semibold">{pending}</span> to review ·{" "}
        <span className="font-mono font-semibold">{accepted}</span> applied
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
          onClick={onDismissAll}
          disabled={pending === 0}
          data-testid="enrichment-dismiss-all"
        >
          Dismiss all
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 bg-ai px-3 text-xs text-ai-foreground hover:bg-ai/90"
          onClick={onAcceptAll}
          disabled={pending === 0}
          data-testid="enrichment-accept-all"
        >
          Apply all ({pending})
        </Button>
      </div>
    </div>
  );
}
