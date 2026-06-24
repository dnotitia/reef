"use client";

import { createAssigneeComboboxOption } from "@/components/assigneeComboboxOption";
import { PersonAvatar, personToneFor } from "@/components/fields/PersonAvatar";
import { PersonChip } from "@/components/fields/PersonChip";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import { useUserSearch } from "@/features/issues/hooks/queries/useUserSearch";
import { useHydrated } from "@/lib/useHydrated";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface AssigneeComboboxProps {
  /** Current assigned_to value (login string or "" for unassigned) */
  value: string;
  /** Called with the selected login, or "" to clear the assignment */
  onChange: (login: string) => void;
  /** Active akb vault — drives the vault-members lookup. */
  vault: string;
  id?: string;
  /** Field name used for accessible labels when reused for requester/reporter. */
  label?: string;
  /** Default: "Search members..." */
  placeholder?: string;
  /** Default: "Unassigned" */
  emptyLabel?: string;
  disabled?: boolean;
  /** Filter affordance — paints the brand ring when set (filter surfaces just). */
  active?: boolean;
  /**
   * Extra classes for the opened dropdown panel. A narrow-trigger surface — the
   * issue filter bar keeps the Assignee/Requester triggers compact (a `9rem`
   * floor) — passes a wider `min-w` here so a long display name and `@login` stay
   * readable in the open list even though the closed trigger stays narrow
   * (REEF-134/269).
   */
  panelClassName?: string;
  /**
   * Panel anchoring. Defaults to `"end"` (right-aligned) so a right-hand trigger
   * — e.g. a dialog header field — keeps the panel inside its clipped container.
   * The issue filter bar passes `"start"` so a widened panel on a narrow trigger
   * that wraps to the start of a row grows rightward into the bar instead of off
   * the left edge (REEF-134), matching the sibling planning filters.
   */
  align?: "start" | "end";
}

/**
 * Assignee typeahead combobox backed by GET /api/vault-members, rendered on the
 * shared `<Combobox>` primitive (REEF-135).
 *
 * - Empty query → lists vault members; non-empty → server-side substring filter
 * - Debounces input 300ms before firing the query (the primitive reports each
 *   keystroke via `onQueryChange`)
 * - Falls back to a plain <Input> when no vault is selected or the query errors
 */
export function AssigneeCombobox({
  value,
  onChange,
  vault,
  id,
  label = "Assignee",
  placeholder = "Search members...",
  emptyLabel = "Unassigned",
  disabled,
  active,
  panelClassName,
  align = "end",
}: AssigneeComboboxProps) {
  const t = useTranslations("components.assignee");
  // rawQuery tracks the live input; debouncedQuery is what the server actually
  // resolved. While they differ (the 300ms debounce window), the visible options
  // belong to the previous query, so the control reports loading to suppress a
  // stale keyboard commit.
  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const mounted = useHydrated();
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
  const {
    data: users,
    isPending,
    isError,
  } = useUserSearch(debouncedQuery, vault);
  const currentLogin = useCurrentUserLogin();

  const options = useMemo<ComboboxOption<string>[]>(
    () =>
      (users ?? []).map((user) =>
        createAssigneeComboboxOption(user, currentLogin),
      ),
    [users, currentLogin],
  );

  // Fallback after a real client-side lookup failure. Rendering the same
  // combobox shell without a vault keeps SSR and the first client render equal.
  if (mounted && isError) {
    return (
      <Input
        id={id}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("vaultMember")}
        disabled={disabled}
        data-testid="assignee-combobox-fallback"
      />
    );
  }

  return (
    <Combobox<string>
      testId="assignee-combobox"
      id={id}
      value={value || null}
      onChange={(v) => onChange(v ?? "")}
      options={options}
      loading={isPending || rawQuery !== debouncedQuery}
      searchable
      onQueryChange={handleQueryChange}
      searchPlaceholder={placeholder}
      placeholder={placeholder}
      renderValue={(login) => (
        <PersonChip
          identityKey={login}
          size="sm"
          tone={personToneFor(login, currentLogin)}
          wrapperClassName="min-w-0 flex-1"
        />
      )}
      noneOption={{
        label: (
          <>
            <PersonAvatar identityKey={null} size="sm" decorative />
            {emptyLabel}
          </>
        ),
      }}
      emptyState={t("noMembers")}
      disabled={disabled || !vault}
      active={active}
      ariaLabel={value ? `${label}: ${value}` : label}
      align={align}
      contentClassName={panelClassName}
    />
  );
}
