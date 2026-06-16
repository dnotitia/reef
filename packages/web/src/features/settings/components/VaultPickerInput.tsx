"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { EnrichedVaultSummary } from "@reef/core";
import { useState } from "react";

interface VaultPickerInputProps {
  /**
   * Vaults to render. Callers are responsible for any pre-filtering
   * (`has_reef_config` etc.) — this component handles search-within-list
   * and selection.
   */
  vaults: readonly EnrichedVaultSummary[];
  /** Currently selected vault name (empty string = nothing selected). */
  value: string;
  /** Fires when the user picks a vault (or "None" if `allowNone`). */
  onChange: (next: string) => void;
  isLoading: boolean;
  isError: boolean;
  /** When true, shows a "None" option at the top of the list. */
  allowNone?: boolean;
  /**
   * Optional prefix for `data-testid` attributes so multiple instances on
   * one page (e.g. storybook variants) don't collide.
   */
  testIdPrefix?: string;
  /** Placeholder shown in the trigger when no vault is selected. */
  placeholder?: string;
}

/**
 * Presentational popover for picking an akb vault. Used by both
 * `RepoPickerSection` (Settings) and the onboarding panel; pre-filtering
 * (e.g. `has_reef_config`) happens at the call site.
 */
export function VaultPickerInput({
  vaults,
  value,
  onChange,
  isLoading,
  isError,
  allowNone = false,
  testIdPrefix = "active-vault",
  placeholder = "Select workspace…",
}: VaultPickerInputProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  if (isLoading) {
    return <Skeleton className="h-9 w-64" />;
  }

  if (isError) {
    return (
      <p
        role="alert"
        className="text-xs text-destructive"
        data-testid="vault-picker-load-error"
      >
        Couldn&apos;t load your workspaces. Try signing out and back in.
      </p>
    );
  }

  const filtered = vaults.filter((v) =>
    v.name.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSelect = (next: string) => {
    setOpen(false);
    setSearch("");
    onChange(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-testid={`${testIdPrefix}-trigger`}
        className="inline-flex h-8 w-64 items-center justify-between rounded-md border border-border bg-elevated px-2.5 text-[13px] text-foreground transition-colors duration-150 hover:bg-surface-hover"
        aria-label={value ? `Active workspace: ${value}` : placeholder}
      >
        <span className="truncate">{value || placeholder}</span>
        <span
          aria-hidden
          className="ml-2 shrink-0 text-xs text-muted-foreground"
        >
          ▾
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2">
        <input
          type="text"
          className="mb-2 w-full rounded-md border border-border bg-elevated px-2 py-1 text-[13px] text-foreground outline-none transition-colors focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
          placeholder="Search workspaces…"
          aria-label="Search workspaces"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid={`${testIdPrefix}-search`}
        />
        <ul className="max-h-48 overflow-y-auto">
          {allowNone && (
            <li>
              <button
                type="button"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleSelect("")}
              >
                None
              </button>
            </li>
          )}
          {filtered.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              No workspaces found.
            </li>
          )}
          {filtered.map((v) => (
            <li key={v.name}>
              <button
                type="button"
                data-testid={`${testIdPrefix}-option-${v.name}`}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground ${
                  value === v.name ? "font-semibold text-foreground" : ""
                }`}
                onClick={() => handleSelect(v.name)}
              >
                {value === v.name && <span className="text-xs">✓</span>}
                <span className="truncate">{v.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
