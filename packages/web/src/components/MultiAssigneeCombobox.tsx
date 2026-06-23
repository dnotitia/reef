"use client";

import { createAssigneeComboboxOption } from "@/components/assigneeComboboxOption";
import type { ComboboxOption } from "@/components/ui/combobox";
import { MultiSelectCombobox } from "@/components/ui/multi-select-combobox";
import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import { useUserSearch } from "@/features/issues/hooks/queries/useUserSearch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface MultiAssigneeComboboxProps {
  /** Currently-selected logins (undefined when the facet is unset). */
  values: readonly string[] | undefined;
  /** Reports a row toggle; the caller folds `[] → undefined` for its store. */
  onToggle: (login: string, checked: boolean) => void;
  /** Active akb vault — drives the vault-members lookup. */
  vault: string;
  /** Field name used for the trigger label and accessible name (Assignee /
   *  Requester). */
  label?: string;
  /** Search-input placeholder. Default: "Search members…". */
  placeholder?: string;
  /** Filter affordance — paints the brand ring when set. */
  active?: boolean;
  triggerTestId?: string;
  contentTestId?: string;
  /** Extra classes for the opened panel (a readable floor for long names). */
  panelClassName?: string;
  align?: "start" | "end";
}

/**
 * Multi-select people filter — the multi-select sibling of `AssigneeCombobox`
 * (REEF-267), used for both the Assignee and Requester issue filters. It runs the
 * same vault-member typeahead (`useUserSearch` + a 300ms debounce) but feeds the
 * searchable `MultiSelectCombobox`, so several logins OR-combine within the
 * facet. The closed trigger shows the shared "(N)" facet summary like every other
 * multi-select facet, which also keeps the trigger short regardless of how many
 * people are picked (REEF-246 truncation concern).
 *
 * Unlike the single-select picker there is no raw-text Input fallback on a
 * lookup error: a filter can narrow to logins that exist, and the trigger
 * count plus the bar's Clear control still let the user drop a stale selection.
 */
export function MultiAssigneeCombobox({
  values,
  onToggle,
  vault,
  label = "Assignee",
  placeholder = "Search members…",
  active,
  triggerTestId,
  contentTestId,
  panelClassName,
  align = "start",
}: MultiAssigneeComboboxProps) {
  // rawQuery tracks the live input; debouncedQuery is what the server resolved.
  // While they differ the visible options belong to the previous query, so the
  // control reports loading (mirrors AssigneeCombobox).
  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleQueryChange = useCallback((q: string) => {
    setRawQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(q), 300);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // isPending (not isLoading) — see useActiveVault for the rationale.
  const { data: users, isPending } = useUserSearch(debouncedQuery, vault);
  const currentLogin = useCurrentUserLogin();

  const options = useMemo<ComboboxOption<string>[]>(
    () =>
      (users ?? []).map((user) =>
        createAssigneeComboboxOption(user, currentLogin),
      ),
    [users, currentLogin],
  );

  return (
    <MultiSelectCombobox<string>
      label={label}
      values={values}
      onToggle={onToggle}
      options={options}
      searchable
      onQueryChange={handleQueryChange}
      searchPlaceholder={placeholder}
      loading={isPending || rawQuery !== debouncedQuery}
      emptyState="No vault members found."
      active={active}
      disabled={!vault}
      ariaLabel={label}
      triggerTestId={triggerTestId}
      contentTestId={contentTestId}
      contentClassName={panelClassName}
      align={align}
    />
  );
}
