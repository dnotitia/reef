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
 * A `null` cached on a passive cookie expiry would otherwise stay fresh for the
 * whole `staleTime`, so the sign-in paths re-fetch identity explicitly: both
 * `LoginForm` and the SSO completion handler invalidate `CURRENT_USER_QUERY_KEY`
 * after a successful login. That covers a same-account re-login too — which
 * `reconcileAkbAccount` treats as a no-op — so the account menu shows the live
 * identity immediately instead of the stale "Account" fallback. The explicit
 * sign-out path additionally clears this query via `AUTH_CHANGED_EVENT` →
 * `queryClient.clear()`. (This closed the REEF-103 cookie-expiry case that
 * REEF-068 had left out of scope.)
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
