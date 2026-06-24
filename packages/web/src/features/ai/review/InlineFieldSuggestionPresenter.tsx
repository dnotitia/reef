"use client";

import type { EnrichmentField } from "@reef/core";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { FieldSuggestionEntry } from "../lib/inlineEnrichment";
import { ArtifactMetadata } from "./ArtifactMetadata";
import { ReviewActions } from "./ReviewActions";

export interface InlineFieldSuggestionPresenterProps {
  field: EnrichmentField;
  entry: FieldSuggestionEntry;
  currentDisplay: ReactNode;
  suggestedDisplay: ReactNode;
  diff?: ReactNode;
  onAccept: () => void;
  onDismiss: () => void;
}

export function InlineFieldSuggestionPresenter({
  field,
  entry,
  currentDisplay,
  suggestedDisplay,
  diff,
  onAccept,
  onDismiss,
}: InlineFieldSuggestionPresenterProps) {
  const t = useTranslations("ai");
  return (
    <div
      data-testid="field-suggestion"
      data-field={field}
      className="min-w-0 overflow-hidden rounded-md border border-ai-border border-l-2 bg-ai-subtle/40 p-2"
    >
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <ArtifactMetadata
          confidence={entry.suggestion.confidence}
          compact
          className="contents"
        />
        {entry.needsReview && (
          <span
            data-testid={`field-suggestion-needs-review-${field}`}
            className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
          >
            {t("review")}
          </span>
        )}
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

      <ArtifactMetadata
        reasoning={entry.suggestion.reasoning}
        compact
        className="mt-1.5"
      />

      <ReviewActions
        compact
        className="mt-2 justify-end gap-1.5"
        actions={[
          {
            id: "dismiss",
            label: t("dismiss"),
            onClick: onDismiss,
            testId: `field-suggestion-dismiss-${field}`,
          },
          {
            id: "approve",
            label: t("apply"),
            onClick: onAccept,
            testId: `field-suggestion-accept-${field}`,
          },
        ]}
      />
    </div>
  );
}
