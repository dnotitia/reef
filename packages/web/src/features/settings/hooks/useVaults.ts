"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { holdQueryUntilHydrated } from "@/lib/queryHydration";
import { useHydrated } from "@/lib/useHydrated";
import {
  type EnrichedVaultSummary,
  EnrichedVaultSummarySchema,
} from "@reef/core";
import { QueryObserver, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CURRENT_USER_QUERY_KEY,
  useCurrentUser,
} from "@/features/auth/hooks/useCurrentUser";

const VaultsResponseSchema = z.object({
  vaults: z.array(EnrichedVaultSummarySchema),
});

/**
 * Lists accessible AKB vaults with each member's minimal app-active state.
 * Product readiness remains a separate selected-workspace server check.
 */
export function useVaults({
  enabled = true,
  management = false,
}: {
  enabled?: boolean;
  management?: boolean;
} = {}) {
  const hydrated = useHydrated();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const scope = management
    ? "management"
    : user.data?.is_admin
      ? "admin"
      : "directory";
  const queryFn = async (): Promise<EnrichedVaultSummary[]> => {
    const profile = queryClient.getQueryState(CURRENT_USER_QUERY_KEY);
    if (profile?.status === "error") throw profile.error;
    const currentUser =
      queryClient.getQueryData<typeof user.data>(CURRENT_USER_QUERY_KEY) ??
      user.data;
    const requestScope = management
      ? "management"
      : currentUser?.is_admin
        ? "admin"
        : "directory";
    const res = await apiFetch(
      requestScope === "directory"
        ? "/api/vaults"
        : `/api/vaults?scope=${requestScope}`,
    );
    if (!res.ok) {
      await throwHttpError(res, `Failed to load vaults: ${res.status}`);
    }
    const data = (await res.json()) as unknown;
    return VaultsResponseSchema.parse(data).vaults;
  };
  const result = useQuery({
    queryKey: [
      "vaults",
      scope,
      user.data?.user_id ?? user.data?.id ?? user.data?.username,
    ] as const,
    queryFn,
    staleTime: 5 * 60 * 1000,
    // Vault roles can change while a partial rollover is waiting for a retry.
    // Revalidate the permission source whenever a protected workspace surface
    // mounts instead of trusting a persisted writer role for the whole stale
    // window.
    refetchOnMount: "always",
    retry: false,
    enabled: enabled && (user.isSuccess || user.isError),
  });

  // The server has no persisted React Query cache, while the browser can
  // restore ["vaults"] synchronously before hydration. Exposing that restored
  // list on the first client render changes loading skeletons, membership
  // gates, and workspace pickers before React has matched the server HTML.
  // Return one deterministic pending snapshot on both sides, then reveal the
  // cache after mount. A disabled query is not sufficient because it still
  // exposes data restored by PersistQueryClientProvider.
  const held = holdQueryUntilHydrated(result, hydrated);
  return {
    ...held,
    refetch: async (...args: Parameters<typeof held.refetch>) => {
      if (user.isError) {
        const retried = await user.refetch();
        if (retried.isError) return held.refetch(...args);
        const nextScope = management
          ? "management"
          : retried.data?.is_admin
            ? "admin"
            : "directory";
        const observer = new QueryObserver(queryClient, {
          queryKey: [
            "vaults",
            nextScope,
            retried.data?.user_id ?? retried.data?.id ?? retried.data?.username,
          ],
          queryFn,
          retry: false,
        });
        try {
          return await observer.refetch({ ...args[0], cancelRefetch: false });
        } finally {
          observer.destroy();
        }
      }
      return held.refetch(...args);
    },
  };
}
