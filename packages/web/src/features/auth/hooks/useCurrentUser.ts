"use client";

import { apiFetch } from "@/lib/apiClient";
import { type AkbMeProfile, AkbMeProfileSchema } from "@reef/core";
import { useQuery } from "@tanstack/react-query";

/**
 * Stable query key for the current akb profile. Hierarchical so any future
 * consumer (a profile page, a mention picker) dedupes to the same fetch
 * instead of issuing its own `/api/auth/akb/me` call.
 */
export const CURRENT_USER_QUERY_KEY = ["auth", "me"] as const;

/**
 * Resolves the signed-in akb user for display (the workspace account menu).
 *
 * `/api/auth/akb/me` decodes the `__reef_session` cookie server-side and
 * returns the public profile. A 401 means there is no live session — we map it
 * to `null` (a logged-out display state) rather than throwing, and disable
 * retries so an expired cookie doesn't spin a refetch loop. Identity rarely
 * changes within a session, so a long `staleTime` keeps this off the hot path.
 *
 * Known, deliberately-deferred limitation: a `null` cached on a cookie expiry
 * stays fresh for `staleTime`, so if the SAME account re-logs-in within that
 * window (reconcile no-ops for same-account), the menu briefly shows the
 * "Account" fallback until the query goes stale. This is the cookie-expiry
 * path REEF-068 left out of scope; it is tracked separately as REEF-103
 * (deferred, minor). The explicit sign-out path already clears this query via
 * `AUTH_CHANGED_EVENT` → `queryClient.clear()`, so just passive expiry is
 * affected. Fix there by invalidating CURRENT_USER_QUERY_KEY on every login.
 */
export function useCurrentUser() {
  return useQuery<AkbMeProfile | null>({
    queryKey: CURRENT_USER_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const res = await apiFetch("/api/auth/akb/me", { signal });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`me failed: ${res.status}`);
      return AkbMeProfileSchema.parse(await res.json());
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}
