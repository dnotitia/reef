"use client";

import { Button } from "@/components/ui/button";
import type { EnrichmentField } from "@reef/core";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { FieldSuggestionEntry } from "../lib/inlineEnrichment";
import { ConfidenceBadge } from "./ConfidenceBadge";

export interface FieldSuggestionProps {
  field: EnrichmentField;
  entry: FieldSuggestionEntry;
  currentDisplay: ReactNode;
  suggestedDisplay: ReactNode;
  diff?: ReactNode;
  onAccept: () => void;
  onDismiss: () => void;
}

/** Inline review card shown in place of a field while its suggestion is pending. */
export function FieldSuggestion({
  field,
  entry,
  currentDisplay,
  suggestedDisplay,
  diff,
  onAccept,
  onDismiss,
}: FieldSuggestionProps) {
  const t = useTranslations("ai");
  return (
    <div
      data-testid="field-suggestion"
      data-field={field}
      className="min-w-0 overflow-hidden rounded-md border border-ai-border border-l-2 bg-ai-subtle/40 p-2"
    >
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <ConfidenceBadge confidence={entry.suggestion.confidence} compact />
        {entry.needsReview ? (
          <span
            data-testid={`field-suggestion-needs-review-${field}`}
            className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
          >
            {t("review")}
          </span>
        ) : null}
      </div>

      {diff ?? (
        <div className="flex min-w-0 flex-col gap-0.5 text-xs">
          <span className="min-w-0 break-words text-muted-foreground line-through decoration-muted-foreground/40">
            {currentDisplay}
          </span>
          <span className="min-w-0 break-words font-medium text-foreground">
            {suggestedDisplay}
          </span>
        </div>
      )}

      <p className="mt-1.5 min-w-0 line-clamp-2 whitespace-pre-wrap break-words text-[11px] italic leading-snug text-muted-foreground">
        {entry.suggestion.reasoning}
      </p>

      <div className="mt-2 flex justify-end gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onDismiss}
          aria-label={t("dismiss")}
          data-testid={`field-suggestion-dismiss-${field}`}
          className="h-6 px-2 text-[11px]"
        >
          <X className="h-3 w-3" />
          {t("dismiss")}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onAccept}
          aria-label={t("apply")}
          data-testid={`field-suggestion-accept-${field}`}
          className="h-6 bg-ai px-2 text-[11px] text-ai-foreground hover:bg-ai/90"
        >
          <Check className="h-3 w-3" />
          {t("apply")}
        </Button>
      </div>
    </div>
  );
}
