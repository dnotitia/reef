import type { EnrichmentField, EnrichmentSuggestion } from "@reef/core";

/**
 * Confidence below this threshold flags a suggestion as "needs review" — it
 * still arrives pending (nothing is auto-applied), but the inline UI marks it
 * so the user gives it a second look before accepting.
 */
const LOW_CONFIDENCE_THRESHOLD = 0.55;

/** Per-field review lifecycle for one suggestion. */
export type SuggestionStatus = "pending" | "accepted" | "dismissed";

/**
 * One suggestion plus its review state. Keyed by `field` in the suggestion
 * map because the enrich agent emits at most one suggestion per field (enforced
 * server-side in `validateSuggestions`), so the field is a stable identity.
 */
export interface FieldSuggestionEntry {
  readonly suggestion: EnrichmentSuggestion;
  readonly status: SuggestionStatus;
  /** `confidence < LOW_CONFIDENCE_THRESHOLD` — still pending, flagged in UI. */
  readonly needsReview: boolean;
}

export type SuggestionMap = ReadonlyMap<EnrichmentField, FieldSuggestionEntry>;

/** Build a fresh map from an enrichment result — every entry starts pending. */
export function buildSuggestionMap(
  suggestions: readonly EnrichmentSuggestion[],
): SuggestionMap {
  const map = new Map<EnrichmentField, FieldSuggestionEntry>();
  for (const suggestion of suggestions) {
    map.set(suggestion.field, {
      suggestion,
      status: "pending",
      needsReview: suggestion.confidence < LOW_CONFIDENCE_THRESHOLD,
    });
  }
  return map;
}
