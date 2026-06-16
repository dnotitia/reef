"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface DebouncedQuery {
  /** The live input value — reflects every keystroke immediately. */
  raw: string;
  /** The settled value, updated `delay` ms after the last keystroke. */
  debounced: string;
  /** Feed each keystroke here. */
  onChange: (value: string) => void;
  /** True while `raw` and `debounced` differ — i.e. a change is still settling. */
  isDebouncing: boolean;
}

/**
 * Debounce a free-text query so a server search fires on the settled value
 * rather than every keystroke. Extracted from AssigneeCombobox (REEF-135) so the
 * member-directory picker (REEF-179) reuses identical timing instead of
 * re-implementing the timer. The caller wires `debounced` to its TanStack Query
 * key and `isDebouncing` into its loading flag so a stale keyboard commit is
 * suppressed while the next query is still in flight.
 */
export function useDebouncedQuery(delay = 300): DebouncedQuery {
  const [raw, setRaw] = useState("");
  const [debounced, setDebounced] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onChange = useCallback(
    (value: string) => {
      setRaw(value);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDebounced(value), delay);
    },
    [delay],
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { raw, debounced, onChange, isDebouncing: raw !== debounced };
}
