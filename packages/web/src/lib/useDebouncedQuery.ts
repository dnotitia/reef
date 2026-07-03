"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Debounce cadence tiers for reef's async search surfaces (REEF-370).
 *
 * The axis is NOT "local vs remote" — every async search surface hits a server —
 * but whether the surface reads through reef-web's own warm cache or a cold akb
 * remote typeahead with no client cache:
 *
 * - WARM: reef-web's own `/api/issues` `q` facet (⌘K `GlobalSearchDialog`, the
 *   issues-list `SearchBar`). `keepPreviousData` warm cache + a client re-filter
 *   over the LIVE query keep results instant, so a short debounce is safe.
 * - COLD: akb remote typeahead with no client cache (people `useUserSearch`,
 *   directory `useDirectorySearch`, documents `useVaultDocumentSearch`). Every
 *   query is a backend round-trip, so a longer debounce throttles the request
 *   rate. The three cold surfaces share one unified value.
 *
 * Immediate in-memory option filters (`Combobox`/`MultiSelectCombobox`) and enum
 * facet selects are NOT debounced — there is no network, so filtering is instant.
 * The combobox's internal 600ms is a keyboard typeahead-buffer reset, not a
 * search debounce, and is unrelated to these tiers.
 */
export const SEARCH_DEBOUNCE_WARM = 150;
export const SEARCH_DEBOUNCE_COLD = 300;

export interface DebouncedQuery {
  /** The live input value — reflects every keystroke immediately. */
  raw: string;
  /** The settled value, updated `delay` ms after the last keystroke. */
  debounced: string;
  /** Feed each keystroke here. */
  onChange: (value: string) => void;
  /**
   * Immediately settle both `raw` and `debounced` to `value` (default `""`),
   * cancelling any pending debounce. For a surface that resets its query on
   * selection/close (⌘K palette, document-ref picker) or clears it (`SearchBar`),
   * so the reset is instant rather than lagging a debounce window.
   */
  reset: (value?: string) => void;
  /** True while `raw` and `debounced` differ — i.e. a change is still settling. */
  isDebouncing: boolean;
}

/**
 * Debounce a free-text query so a server search fires on the settled value
 * rather than every keystroke. Originally extracted from AssigneeCombobox
 * (REEF-135) so the member-directory picker (REEF-179) reuses identical timing;
 * REEF-370 makes it the single debounce primitive for every async search surface,
 * with the cadence named by tier (`SEARCH_DEBOUNCE_WARM`/`SEARCH_DEBOUNCE_COLD`)
 * instead of a magic number scattered per surface. The caller wires `debounced`
 * to its TanStack Query key and `isDebouncing` into its loading flag so a stale
 * keyboard commit is suppressed while the next query is still in flight; `reset`
 * clears or re-seeds the query without waiting out the debounce.
 *
 * `initial` seeds both `raw` and `debounced` on first render — used by `SearchBar`
 * so a persisted/restored query is reflected in the input on mount.
 */
export function useDebouncedQuery(
  delay: number = SEARCH_DEBOUNCE_COLD,
  initial = "",
): DebouncedQuery {
  const [raw, setRaw] = useState(initial);
  const [debounced, setDebounced] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onChange = useCallback(
    (value: string) => {
      setRaw(value);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDebounced(value), delay);
    },
    [delay],
  );

  const reset = useCallback((value = "") => {
    if (timer.current) clearTimeout(timer.current);
    setRaw(value);
    setDebounced(value);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { raw, debounced, onChange, reset, isDebouncing: raw !== debounced };
}
