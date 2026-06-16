"use client";

import type { EnrichmentField } from "@reef/core";
import type { ReactNode } from "react";
import type { FieldSuggestionEntry } from "../lib/inlineEnrichment";
import { InlineFieldSuggestionPresenter } from "../review/InlineFieldSuggestionPresenter";

export interface FieldSuggestionProps {
  field: EnrichmentField;
  entry: FieldSuggestionEntry;
  /** Pre-formatted current form value (descriptor.formatCurrent). */
  currentDisplay: ReactNode;
  /** Pre-formatted suggested value (descriptor.formatSuggested). */
  suggestedDisplay: ReactNode;
  /** Optional diff block (title/body) — replaces the current→suggested row. */
  diff?: ReactNode;
  onAccept: () => void;
  onDismiss: () => void;
}

/**
 * Inline review card that REPLACES a field's normal input control while its
 * suggestion is pending. Purely presentational and  rendered for the
 * pending state — once accepted/dismissed the parent swaps the real control
 * back in (an accepted value is already written to form state).
 */
export function FieldSuggestion({
  field,
  entry,
  currentDisplay,
  suggestedDisplay,
  diff,
  onAccept,
  onDismiss,
}: FieldSuggestionProps) {
  return (
    <InlineFieldSuggestionPresenter
      field={field}
      entry={entry}
      currentDisplay={currentDisplay}
      suggestedDisplay={suggestedDisplay}
      diff={diff}
      onAccept={onAccept}
      onDismiss={onDismiss}
    />
  );
}
