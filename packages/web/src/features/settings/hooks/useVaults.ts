"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
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
  return useQuery({
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
}
