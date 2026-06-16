"use client";

import type { EnrichmentField, EnrichmentSuggestion } from "@reef/core";
import { useCallback, useMemo, useState } from "react";
import {
  type EnrichmentFormApi,
  applySuggestionToForm,
} from "../lib/enrichmentFieldDescriptors";
import {
  type FieldSuggestionEntry,
  type SuggestionMap,
  buildSuggestionMap,
} from "../lib/inlineEnrichment";

export interface InlineEnrichmentCounts {
  /** status === "pending" */
  readonly pending: number;
  /** status === "accepted" */
  readonly accepted: number;
  /** status === "dismissed" */
  readonly dismissed: number;
  /** pending AND low-confidence */
  readonly needsReview: number;
}

export interface UseInlineEnrichmentResult {
  /** Review entry for a field, or undefined if no suggestion targets it. */
  getEntry: (field: EnrichmentField) => FieldSuggestionEntry | undefined;
  /** Fields still pending review, in suggestion arrival order. */
  pendingFields: readonly EnrichmentField[];
  counts: InlineEnrichmentCounts;
  /** True while any suggestion (any status) is in the map. */
  hasAny: boolean;
  /** Apply one pending field's suggestion to the form and mark it accepted. */
  accept: (field: EnrichmentField) => void;
  /** Dismiss one pending field's suggestion without touching the form. */
  dismiss: (field: EnrichmentField) => void;
  /** Apply every currently-pending suggestion, in arrival order. */
  acceptAll: () => void;
  /** Dismiss every currently-pending suggestion. */
  dismissAll: () => void;
  /** Replace the map from a fresh enrichment result (all entries pending). */
  ingest: (suggestions: readonly EnrichmentSuggestion[]) => void;
  /** Clear all review state (dialog close / before a re-run). */
  reset: () => void;
}

/**
 * Owns the per-field enrichment review lifecycle for a single New Issue dialog
 * instance. Deliberately a plain hook with local state — the lifecycle dies
 * with the dialog, so a module-global store would be wrong (it would leak
 * across opens and couldn't host two dialogs).
 *
 * Applying a suggestion is delegated to `applySuggestionToForm` (the descriptor
 * map), so the hook does not hard-codes the 18 field setters — it just owns
 * review status. `form` should be a stable reference (memoize it in the caller).
 */
export function useInlineEnrichment(
  form: EnrichmentFormApi,
): UseInlineEnrichmentResult {
  const [map, setMap] = useState<SuggestionMap>(() => new Map());

  const ingest = useCallback((suggestions: readonly EnrichmentSuggestion[]) => {
    setMap(buildSuggestionMap(suggestions));
  }, []);

  const reset = useCallback(() => {
    setMap(new Map());
  }, []);

  const setStatus = useCallback(
    (field: EnrichmentField, status: FieldSuggestionEntry["status"]) => {
      setMap((prev) => {
        const entry = prev.get(field);
        if (!entry || entry.status === status) return prev;
        const next = new Map(prev);
        next.set(field, { ...entry, status });
        return next;
      });
    },
    [],
  );

  const accept = useCallback(
    (field: EnrichmentField) => {
      const entry = map.get(field);
      if (!entry || entry.status !== "pending") return;
      applySuggestionToForm(form, entry.suggestion);
      setStatus(field, "accepted");
    },
    [map, form, setStatus],
  );

  const dismiss = useCallback(
    (field: EnrichmentField) => {
      setStatus(field, "dismissed");
    },
    [setStatus],
  );

  const acceptAll = useCallback(() => {
    for (const entry of map.values()) {
      if (entry.status === "pending") {
        applySuggestionToForm(form, entry.suggestion);
      }
    }
    setMap((prev) => {
      const next = new Map(prev);
      for (const [field, entry] of next) {
        if (entry.status === "pending") {
          next.set(field, { ...entry, status: "accepted" });
        }
      }
      return next;
    });
  }, [map, form]);

  const dismissAll = useCallback(() => {
    setMap((prev) => {
      const next = new Map(prev);
      for (const [field, entry] of next) {
        if (entry.status === "pending") {
          next.set(field, { ...entry, status: "dismissed" });
        }
      }
      return next;
    });
  }, []);

  const getEntry = useCallback(
    (field: EnrichmentField) => map.get(field),
    [map],
  );

  const pendingFields = useMemo(
    () =>
      [...map.entries()]
        .filter(([, entry]) => entry.status === "pending")
        .map(([field]) => field),
    [map],
  );

  const counts = useMemo<InlineEnrichmentCounts>(() => {
    let pending = 0;
    let accepted = 0;
    let dismissed = 0;
    let needsReview = 0;
    for (const entry of map.values()) {
      if (entry.status === "pending") {
        pending++;
        if (entry.needsReview) needsReview++;
      } else if (entry.status === "accepted") {
        accepted++;
      } else {
        dismissed++;
      }
    }
    return { pending, accepted, dismissed, needsReview };
  }, [map]);

  return {
    getEntry,
    pendingFields,
    counts,
    hasAny: map.size > 0,
    accept,
    dismiss,
    acceptAll,
    dismissAll,
    ingest,
    reset,
  };
}
