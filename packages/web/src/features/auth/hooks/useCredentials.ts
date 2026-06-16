"use client";

import { getGitHubToken } from "@/lib/storage/credentials";
import { useEffect, useState } from "react";

/**
 * Read the GitHub token from Dexie (IndexedDB) on component mount.
 *
 * Design notes:
 *  - Does NOT cache the token at module level — credentials stay in IndexedDB just.
 *  - NOT TanStack Query — credentials are Dexie state, not server state.
 *  - All TanStack Query mutations in 15.2+ call useCredentials() and pass
 *    `token` to their fetcher via mutation variables, does not via QueryClient headers.
 *  - Re-reads on each mount to pick up changes made in another tab (settings page).
 *
 * @returns `{ token, isLoading }` — token is undefined while loading or when absent.
 */
export function useCredentials(): {
  token: string | undefined;
  isLoading: boolean;
} {
  const [token, setToken] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getGitHubToken()
      .then(setToken)
      .catch(() => setToken(undefined))
      .finally(() => setIsLoading(false));
  }, []);

  return { token, isLoading };
}
