"use client";

import { Input } from "@/components/ui/input";
import {
  SEARCH_DEBOUNCE_WARM,
  useDebouncedQuery,
} from "@/lib/useDebouncedQuery";
import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef } from "react";
import { useIssueStore } from "../../stores/useIssueStore";

export function SearchBar() {
  const t = useTranslations("issues.filters");
  const setSearchQuery = useIssueStore((state) => state.setSearchQuery);

  // The issue store is the search's data owner; the shared warm-tier debounce
  // (REEF-370) replaces the previous inline 150ms timer. `initial` seeds the
  // input from any persisted/restored query on mount.
  const {
    raw: localValue,
    onChange: handleChange,
    debounced,
    reset,
  } = useDebouncedQuery(
    SEARCH_DEBOUNCE_WARM,
    useIssueStore.getState().searchQuery,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // Push the settled value into the store so the list query re-runs on it.
  useEffect(() => {
    setSearchQuery(debounced);
  }, [debounced, setSearchQuery]);

  // Reflect an external store change (a restored/persisted filter, or a clear
  // from elsewhere) back into the input.
  useEffect(() => {
    return useIssueStore.subscribe((state, previousState) => {
      if (state.searchQuery !== previousState.searchQuery) {
        reset(state.searchQuery);
      }
    });
  }, [reset]);

  const handleClear = useCallback(() => {
    reset("");
    setSearchQuery("");
    inputRef.current?.blur();
  }, [reset, setSearchQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        handleClear();
      }
    },
    [handleClear],
  );

  return (
    <div className="relative flex items-center" data-testid="search-bar">
      <Search className="absolute left-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        ref={inputRef}
        className="pl-9 pr-8 h-9"
        placeholder={t("searchPlaceholder")}
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        data-testid="search-input"
      />
      {localValue && (
        <button
          type="button"
          className="absolute right-2 flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:text-foreground"
          onClick={handleClear}
          data-testid="search-clear-button"
          aria-label={t("clearSearch")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
