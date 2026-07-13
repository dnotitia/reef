"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { holdQueryUntilHydrated } from "@/lib/queryHydration";
import { useHydrated } from "@/lib/useHydrated";
import {
  type EnrichedVaultSummary,
  EnrichedVaultSummarySchema,
} from "@reef/core";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const VaultsResponseSchema = z.object({
  vaults: z.array(EnrichedVaultSummarySchema),
});

/**
 * Lists the akb vaults the signed-in user can access. Each entry carries
 * `has_reef_config` so callers can offer just vaults that already have a reef
 * config: both onboarding and the Settings active-workspace picker filter on it
 * (REEF-143).
 */
export function useVaults() {
  const hydrated = useHydrated();
  const result = useQuery({
    queryKey: ["vaults"] as const,
    queryFn: async (): Promise<EnrichedVaultSummary[]> => {
      const res = await apiFetch("/api/vaults");
      if (!res.ok) {
        await throwHttpError(res, `Failed to load vaults: ${res.status}`);
      }
      const data = (await res.json()) as unknown;
      return VaultsResponseSchema.parse(data).vaults;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // The server has no persisted React Query cache, while the browser can
  // restore ["vaults"] synchronously before hydration. Exposing that restored
  // list on the first client render changes loading skeletons, membership
  // gates, and workspace pickers before React has matched the server HTML.
  // Return one deterministic pending snapshot on both sides, then reveal the
  // cache after mount. A disabled query is not sufficient because it still
  // exposes data restored by PersistQueryClientProvider.
  return holdQueryUntilHydrated(result, hydrated);
}
