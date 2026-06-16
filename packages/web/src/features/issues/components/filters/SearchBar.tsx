"use client";

import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIssueStore } from "../../stores/useIssueStore";

export function SearchBar() {
  const setSearchQuery = useIssueStore((state) => state.setSearchQuery);

  const [localValue, setLocalValue] = useState(
    () => useIssueStore.getState().searchQuery,
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return useIssueStore.subscribe((state, previousState) => {
      if (state.searchQuery !== previousState.searchQuery) {
        setLocalValue(state.searchQuery);
      }
    });
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      setLocalValue(value);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setSearchQuery(value);
      }, 150);
    },
    [setSearchQuery],
  );

  const handleClear = useCallback(() => {
    setLocalValue("");
    setSearchQuery("");
    inputRef.current?.blur();
  }, [setSearchQuery]);

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
        placeholder="Search issues..."
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
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
