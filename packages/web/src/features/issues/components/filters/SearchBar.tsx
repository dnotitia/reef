"use client";

import { Input } from "@/components/ui/input";
import { SearchProgressBar } from "@/components/ui/SearchProgressBar";
import {
  SEARCH_DEBOUNCE_WARM,
  useDebouncedQuery,
} from "@/lib/useDebouncedQuery";
import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { startTransition, useCallback, useEffect, useRef } from "react";
import { useIssueStore } from "../../stores/useIssueStore";

export function SearchBar() {
  const t = useTranslations("issues.filters");
  const common = useTranslations("common");
  const setSearchQuery = useIssueStore((state) => state.setSearchQuery);

  // The issue store is the search's data owner; the shared warm-tier debounce
  // (REEF-370) replaces the previous inline 150ms timer. `initial` seeds the
  // input from any persisted/restored query on mount.
  const {
    raw: localValue,
    onChange: handleChange,
    debounced,
    reset,
    isDebouncing,
  } = useDebouncedQuery(
    SEARCH_DEBOUNCE_WARM,
    useIssueStore.getState().searchQuery,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const localValueRef = useRef(localValue);
  const debouncedValueRef = useRef(debounced);
  localValueRef.current = localValue;
  debouncedValueRef.current = debounced;

  // Push the settled value into the store so the list query re-runs on it.
  useEffect(() => {
    startTransition(() => {
      setSearchQuery(debounced);
    });
  }, [debounced, setSearchQuery]);

  // Reflect an external store change (a restored/persisted filter, or a clear
  // from elsewhere) back into the input.
  useEffect(() => {
    return useIssueStore.subscribe((state, previousState) => {
      const searchChanged = state.searchQuery !== previousState.searchQuery;
      const resetRequested =
        state.searchQueryResetToken !== previousState.searchQueryResetToken;
      if (!searchChanged && !resetRequested) return;

      // A result consumer can keep the main thread busy after the debounce
      // value has been committed. While the user is typing, an older store
      // write must not restore that value over the live draft. Explicit reset
      // intents (My View, clear filters, URL adoption, or a vault switch) carry
      // the monotonic token and always win.
      if (
        !resetRequested &&
        localValueRef.current !== debouncedValueRef.current
      ) {
        return;
      }
      reset(state.searchQuery);
    });
  }, [reset]);

  const handleClear = useCallback(() => {
    reset("");
    setSearchQuery("");
    inputRef.current?.blur();
  }, [reset, setSearchQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Escape") {
        handleClear();
      }
    },
    [handleClear],
  );

  return (
    <div
      className="relative flex w-full min-w-0 items-center"
      data-testid="search-bar"
    >
      <Search className="absolute left-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        ref={inputRef}
        className="pl-9 pr-8 h-9"
        placeholder={t("searchPlaceholder")}
        aria-label={t("searchLabel")}
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        data-testid="search-input"
      />
      {/* Keep feedback visible through the local debounce gap; the result
          surface takes over once the settled query reaches its fetch state. */}
      <SearchProgressBar active={isDebouncing} />
      {isDebouncing ? (
        <span role="status" aria-live="polite" className="sr-only">
          {common("updatingResults")}
        </span>
      ) : null}
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
