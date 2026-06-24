"use client";

import { PersonAvatar, personToneFor } from "@/components/fields/PersonAvatar";
import { PersonChip } from "@/components/fields/PersonChip";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { useDirectorySearch } from "@/features/settings/hooks/useDirectorySearch";
import { useDebouncedQuery } from "@/lib/useDebouncedQuery";
import type { UserSearchResult } from "@reef/core";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

interface DirectorySearchComboboxProps {
  /** Workspace being managed — scopes the route's admin check and the cache. */
  vault: string;
  selectedUser: UserSearchResult | null;
  onSelect: (user: UserSearchResult | null) => void;
  /** Usernames already in the workspace — shown disabled ("Already a member"). */
  existingKeys: ReadonlySet<string>;
  currentLogin: string | null;
  disabled?: boolean;
}

/**
 * Picker for the add-member form (REEF-179). Searches the GLOBAL akb directory
 * (`useDirectorySearch`) — not the current members — so admins can find users
 * who are not yet in the workspace. Members already present are rendered
 * disabled so a redundant grant is does not issued. Shares the assignee picker's
 * 300ms debounce via `useDebouncedQuery` and the same `Combobox` chrome.
 */
export function DirectorySearchCombobox({
  vault,
  selectedUser,
  onSelect,
  existingKeys,
  currentLogin,
  disabled,
}: DirectorySearchComboboxProps) {
  const t = useTranslations("directorySearch");
  const { debounced, onChange, isDebouncing } = useDebouncedQuery();
  const {
    data: users,
    isPending,
    isError,
  } = useDirectorySearch(debounced, vault, !disabled);

  const options = useMemo<ComboboxOption<string>[]>(
    () =>
      (users ?? []).map((u) => {
        const already = existingKeys.has(u.username);
        return {
          value: u.username,
          label: u.display_name ?? u.username,
          keywords: u.username,
          disabled: already,
          testId: `directory-option-${u.username}`,
          content: (
            <>
              <PersonAvatar
                identityKey={u.username}
                name={u.display_name ?? undefined}
                size="sm"
                tone={personToneFor(u.username, currentLogin)}
                decorative
              />
              <span className="truncate">{u.display_name ?? u.username}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {already ? t("alreadyMember") : `@${u.username}`}
              </span>
            </>
          ),
        };
      }),
    [users, existingKeys, currentLogin, t],
  );

  return (
    <Combobox<string>
      testId="member-directory-combobox"
      value={selectedUser?.username ?? null}
      onChange={(v) =>
        onSelect(
          v ? ((users ?? []).find((u) => u.username === v) ?? null) : null,
        )
      }
      options={options}
      loading={isPending || isDebouncing}
      searchable
      onQueryChange={onChange}
      searchPlaceholder={t("searchPlaceholder")}
      placeholder={t("placeholder")}
      renderValue={() =>
        selectedUser ? (
          <PersonChip
            identityKey={selectedUser.username}
            name={selectedUser.display_name}
            size="sm"
            tone={personToneFor(selectedUser.username, currentLogin)}
            wrapperClassName="min-w-0 flex-1"
          />
        ) : null
      }
      emptyState={isError ? t("error") : t("noMatches")}
      disabled={disabled}
      ariaLabel={t("addMember")}
    />
  );
}
