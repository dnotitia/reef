"use client";

import { useProjectConfig } from "@/features/settings/hooks/useProjectConfig";
import {
  getActivityRepo,
  setActivityRepo as setActivityRepoDexie,
} from "@/lib/storage/config";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

export interface ActivityRepoState {
  /**
   * The currently selected scan target as a GitHub `owner/name`. Empty when
   * the active vault has no `monitored_repos` configured — callers gate
   * detection + the refresh button on this.
   */
  repo: string;
  /** `"owner/name"` strings from the active vault's monitored_repos. */
  monitoredRepos: readonly string[];
  /** Persist a new selection to Dexie. */
  setRepo: (repo: string) => Promise<void>;
  isLoading: boolean;
}

function activityRepoQueryKey(vault: string) {
  return ["activity-repo", vault] as const;
}

/**
 * Pairs the active vault's `monitored_repos` (from `useProjectConfig`) with a
 * per-vault Dexie pointer that remembers which repo the user is currently
 * scanning for untracked activity.
 *
 * Falls back to `monitored_repos[0]` when no pointer is saved, so first-run
 * "just works" without forcing the user through a picker interaction. When
 * the saved pointer no longer matches any of the vault's monitored repos
 * (the team removed it via Settings), the same fallback kicks in — keeps
 * detection alive instead of failing silently with a stale repo string.
 *
 * Returns `repo: ""` when the vault has no monitored repos at all. Consumers
 * (`ActivityFeed`, `DashboardShell` auto-trigger) treat that as the signal
 * to render an empty state and suppress detection.
 */
export function useActivityRepo(vault: string): ActivityRepoState {
  const queryClient = useQueryClient();

  const configQuery = useProjectConfig(vault);
  const monitoredRepos = useMemo<readonly string[]>(() => {
    const list = configQuery.data?.config.monitored_repos ?? [];
    return list.map((r) => `${r.owner}/${r.name}`);
  }, [configQuery.data]);

  const savedRepoQuery = useQuery({
    queryKey: activityRepoQueryKey(vault),
    queryFn: () => getActivityRepo(vault).then((v) => v ?? ""),
    enabled: vault.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  // `undefined` while Dexie is still resolving (or the query is disabled
  // because vault is ""). We should not flatten that to "" — doing so would
  // trip the fallback below and let `DashboardShell`'s auto-trigger scan
  // `monitoredRepos[0]` in the brief window before the user's saved
  // preference settles. Consumers gate on the `""` return + `isLoading`.
  const savedRepo = savedRepoQuery.data;

  // Saved choice still in the vault's monitored list? Use it. Otherwise pick
  // the first available — keeps detection alive when a repo is removed via
  // Settings without requiring the user to revisit the picker. `""` (no saved
  // choice) flows through `includes()` as a miss because `monitoredRepos`
  // entries are validated `owner/name` and can not be empty.
  const effectiveRepo = useMemo(() => {
    if (savedRepo === undefined) return "";
    if (monitoredRepos.includes(savedRepo)) return savedRepo;
    return monitoredRepos[0] ?? "";
  }, [savedRepo, monitoredRepos]);

  const setRepoMutation = useMutation({
    mutationFn: async (next: string) => {
      await setActivityRepoDexie(vault, next);
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(activityRepoQueryKey(vault), next);
    },
  });

  // Stay loading until both Dexie and the project-config query have produced
  // data. `useQuery.isPending` is also true when the query is disabled
  // (vault === ""), so key off `data` directly — the disabled case is
  // covered by the outer `vault.length > 0` guard.
  const isLoading =
    vault.length > 0 && (savedRepo === undefined || configQuery.isPending);

  return {
    repo: effectiveRepo,
    monitoredRepos,
    setRepo: async (next) => {
      await setRepoMutation.mutateAsync(next);
    },
    isLoading,
  };
}
