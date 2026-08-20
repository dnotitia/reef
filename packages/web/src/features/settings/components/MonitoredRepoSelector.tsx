"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  usePopoverContext,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { RepoListItem } from "@/features/settings/hooks/useRepos";
import type { MonitoredRepo } from "@reef/core";
import { ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";

interface MonitoredRepoSelectorProps {
  availableRepos: readonly RepoListItem[];
  selectedRepos: ReadonlySet<string>;
  onToggle: (repo: string) => void;
  isLoading: boolean;
  isError: boolean;
  disabled?: boolean;
  /** Shown when `isError` and not loading; a node so callers can link out. */
  errorMessage?: ReactNode;
  testIdPrefix?: string;
}

interface MonitoredRepoOptionProps {
  repo: RepoListItem;
  checked: boolean;
  disabled: boolean;
  onToggle: (repo: string) => void;
  testIdPrefix: string;
}

function MonitoredRepoOption({
  repo,
  checked,
  disabled,
  onToggle,
  testIdPrefix,
}: MonitoredRepoOptionProps) {
  const { close } = usePopoverContext();

  return (
    <li>
      <button
        type="button"
        data-testid={`${testIdPrefix}-option-${repo.full_name}`}
        disabled={disabled}
        aria-label={repo.full_name}
        aria-pressed={checked}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
        onClick={() => {
          onToggle(repo.full_name);
          close("select");
        }}
      >
        <input
          type="checkbox"
          readOnly
          checked={checked}
          className="h-3.5 w-3.5 rounded"
          tabIndex={-1}
          aria-hidden
        />
        <span className="truncate">{repo.full_name}</span>
      </button>
    </li>
  );
}

/**
 * Preserve metadata for already-saved repos and synthesize a full
 * `MonitoredRepo` (including the GitHub numeric `github_id`) for newly
 * selected entries by looking them up in `availableRepos`. Throws if a
 * selected full_name is not present in `availableRepos` AND not in the
 * existing saved list — this should not happen in normal flows because the
 * user can select from the available list.
 */
export function buildMonitoredReposPayload(
  current: readonly MonitoredRepo[],
  selectedFullNames: ReadonlySet<string>,
  availableRepos: readonly RepoListItem[],
): MonitoredRepo[] {
  const existing = new Map<string, MonitoredRepo>(
    current.map((r) => [`${r.owner}/${r.name}`, r]),
  );
  const lookup = new Map<string, RepoListItem>(
    availableRepos.map((r) => [r.full_name, r]),
  );
  return Array.from(selectedFullNames).map((fullName) => {
    const found = existing.get(fullName);
    if (found) return found;
    const item = lookup.get(fullName);
    if (!item) {
      throw new Error(
        `Cannot add monitored repo "${fullName}": missing GitHub repo metadata. Refresh the repo list and try again.`,
      );
    }
    const [owner, name] = fullName.split("/") as [string, string];
    return { github_id: item.id, owner, name };
  });
}

export function MonitoredRepoSelector({
  availableRepos,
  selectedRepos,
  onToggle,
  isLoading,
  isError,
  disabled = false,
  errorMessage,
  testIdPrefix = "monitored-repos",
}: MonitoredRepoSelectorProps) {
  const t = useTranslations("settings.misc");
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const resolvedErrorMessage = errorMessage ?? t("connectGithubFirst");

  const filteredRepos = useMemo(
    () =>
      availableRepos.filter((r) =>
        r.full_name.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [availableRepos, searchQuery],
  );

  if (isError && !isLoading) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid={`${testIdPrefix}-load-error`}
      >
        {resolvedErrorMessage}
      </p>
    );
  }

  if (isLoading) {
    return (
      <Skeleton
        className="h-9 w-full max-w-64"
        data-testid={`${testIdPrefix}-loading`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen} className="w-full max-w-64">
        <PopoverTrigger
          data-testid={`${testIdPrefix}-trigger`}
          aria-haspopup="dialog"
          disabled={disabled}
          className="inline-flex h-8 w-full max-w-full min-w-0 items-center justify-between rounded-md border border-border bg-surface-elevated px-2.5 text-[13px] text-foreground transition-colors duration-150 hover:bg-surface-hover disabled:opacity-50"
          aria-label={
            selectedRepos.size > 0
              ? t("reposSelected", { count: selectedRepos.size })
              : t("selectMonitoredRepos")
          }
        >
          <span className="truncate">
            {selectedRepos.size > 0
              ? t("reposSelected", { count: selectedRepos.size })
              : t("selectReposPlaceholder")}
          </span>
          <ChevronDown
            aria-hidden
            className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground"
          />
        </PopoverTrigger>
        <PopoverContent
          role="dialog"
          aria-label={t("searchReposLabel")}
          className="w-full max-w-64 min-w-0 p-2"
        >
          <input
            type="text"
            className="mb-2 w-full rounded-md border border-border bg-surface-elevated px-2 py-1 text-[13px] text-foreground outline-none transition-colors focus-visible:border-brand-focus focus-visible:ring-2 focus-visible:ring-brand-focus/30"
            placeholder={t("searchReposPlaceholder")}
            aria-label={t("searchReposLabel")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid={`${testIdPrefix}-search`}
          />
          <ul className="max-h-48 overflow-y-auto">
            {filteredRepos.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">
                {t("noReposFound")}
              </li>
            )}
            {filteredRepos.map((repo) => {
              const checked = selectedRepos.has(repo.full_name);
              return (
                <MonitoredRepoOption
                  key={repo.id}
                  repo={repo}
                  checked={checked}
                  disabled={disabled}
                  onToggle={onToggle}
                  testIdPrefix={testIdPrefix}
                />
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>

      {selectedRepos.size > 0 && (
        <div className="flex flex-wrap gap-1">
          {Array.from(selectedRepos).map((repo) => (
            <span
              key={repo}
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-foreground"
            >
              <span className="min-w-0 truncate" title={repo}>
                {repo}
              </span>
              <button
                type="button"
                disabled={disabled}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted-foreground"
                aria-label={t("removeRepo", { repo })}
                onClick={() => onToggle(repo)}
              >
                <X aria-hidden className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
