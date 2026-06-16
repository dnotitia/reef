"use client";

import { AUTH_CHANGED_EVENT } from "@/lib/storage/clientCache";
import { getGitHubToken } from "@/lib/storage/credentials";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * Stable query key for "is a GitHub token configured". Hierarchical so any
 * consumer (useRepos, useScanAutoTrigger, RepoPickerSection) dedupes to the
 * same single IndexedDB read instead of probing the store independently.
 */
const GITHUB_TOKEN_PRESENT_QUERY_KEY = ["github", "token-present"] as const;

export interface GithubTokenState {
  /** True when a GitHub PAT is stored in IndexedDB. The value itself is does not exposed. */
  hasToken: boolean;
  /** True while the initial IndexedDB read is in flight. */
  isLoading: boolean;
}

/**
 * Single canonical source for whether the browser has a GitHub token, used to
 * gate every GitHub-dependent call so an unconfigured workspace does not spams
 * 401s (REEF-159). Mirrors `useAiAvailable`: it exposes just a boolean
 * capability flag, does not the secret.
 *
 * `staleTime: Infinity` because the token just changes through
 * `setGitHubToken`/`clearGitHubToken`, which broadcast `AUTH_CHANGED_EVENT`.
 * This hook subscribes to that event and invalidates its own read, so re-saving
 * a token flips the gate and the GitHub-dependent calls resume without a manual
 * refresh (REEF-159 AC3). Subscribing directly — rather than relying solely on
 * QueryProvider's `AUTH_CHANGED_EVENT → queryClient.clear()` — keeps the gate
 * correct under any provider (including test harnesses that mount a bare
 * QueryClientProvider) and alongside the explicit `['repos','list']`
 * invalidation the onboarding token tile already fires. `retry: false` so a
 * transient Dexie read failure resolves to "no token" instead of spinning.
 */
export function useHasGithubToken(): GithubTokenState {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: GITHUB_TOKEN_PRESENT_QUERY_KEY,
    queryFn: async () => (await getGitHubToken()) !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      void queryClient.invalidateQueries({
        queryKey: GITHUB_TOKEN_PRESENT_QUERY_KEY,
      });
    };
    window.addEventListener(AUTH_CHANGED_EVENT, handler);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, handler);
  }, [queryClient]);

  return {
    hasToken: query.data ?? false,
    isLoading: query.isLoading,
  };
}
