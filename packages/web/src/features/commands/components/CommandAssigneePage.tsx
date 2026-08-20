"use client";

import { createAssigneeComboboxOption } from "@/components/assigneeComboboxOption";
import { PersonAvatar } from "@/components/fields/PersonAvatar";
import { SearchProgressBar } from "@/components/ui/SearchProgressBar";
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import type {
  CommandIssueTarget,
  CommandRegistry,
} from "@/features/commands/hooks/useCommandRegistry";
import { useUserSearch } from "@/features/issues/hooks/queries/useUserSearch";
import {
  SEARCH_DEBOUNCE_COLD,
  useDebouncedQuery,
} from "@/lib/useDebouncedQuery";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";

interface CommandAssigneePageProps {
  query: string;
  vault: string;
  target: CommandIssueTarget;
  registry: CommandRegistry;
  onExecute: (run: () => void) => void;
}

export function CommandAssigneePage({
  query,
  vault,
  target,
  registry,
  onExecute,
}: CommandAssigneePageProps) {
  const t = useTranslations("commands");
  const currentLogin = useCurrentUserLogin();
  const {
    debounced,
    onChange: setDebouncedQuery,
    isDebouncing,
  } = useDebouncedQuery(SEARCH_DEBOUNCE_COLD);
  useEffect(() => setDebouncedQuery(query), [query, setDebouncedQuery]);
  const users = useUserSearch(debounced, vault);
  const current = registry.getFreshIssue(target.issueId)?.assigned_to ?? null;
  const options = useMemo(
    () =>
      (users.data ?? []).map((user) =>
        createAssigneeComboboxOption(user, currentLogin),
      ),
    [currentLogin, users.data],
  );
  const loading = users.isPending || isDebouncing;

  if (users.isError) {
    return (
      <CommandEmpty data-testid="command-assignee-error">
        {t("assignee.error")}
      </CommandEmpty>
    );
  }

  return (
    <CommandGroup heading={t("pages.assignee")}>
      <div className="relative">
        <SearchProgressBar active={loading} />
      </div>
      {!query.trim() ? (
        <CommandItem
          value="assignee.unassigned"
          keywords={[t("assignee.unassigned")]}
          data-testid="command-assignee-unassigned"
          onSelect={() =>
            onExecute(() => registry.executeAssignee(target, null))
          }
        >
          <PersonAvatar identityKey={null} size="sm" decorative />
          <span className="truncate">{t("assignee.unassigned")}</span>
          {current === null ? (
            <Check
              className="ml-auto size-4 text-brand-text"
              aria-label={t("current")}
            />
          ) : null}
        </CommandItem>
      ) : null}
      {loading ? (
        <div
          className="px-2 py-6 text-center text-sm text-muted-foreground"
          data-testid="command-assignee-loading"
        >
          {t("assignee.loading")}
        </div>
      ) : null}
      {!loading &&
        options.map((option) => (
          <CommandItem
            key={option.value}
            value={`assignee.${option.value}`}
            keywords={[option.label, option.keywords ?? ""]}
            data-testid="command-assignee-option"
            data-assignee={option.value}
            onSelect={() =>
              onExecute(() => registry.executeAssignee(target, option.value))
            }
          >
            {option.content}
            {current === option.value ? (
              <Check
                className="ml-2 size-4 text-brand-text"
                aria-label={t("current")}
              />
            ) : null}
          </CommandItem>
        ))}
      {!loading && options.length === 0 ? (
        <CommandEmpty>{t("assignee.empty")}</CommandEmpty>
      ) : null}
    </CommandGroup>
  );
}
