"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { ActivitySuggestionsResultSchema } from "@reef/core";
import { useQuery } from "@tanstack/react-query";
import { activitySuggestionsQueryKey } from "./useActivityFeed";

export function usePendingSuggestionsCount(vault: string): number {
  const query = useQuery({
    queryKey: activitySuggestionsQueryKey(vault),
    queryFn: async () => {
      const params = new URLSearchParams({ vault, status: "pending" });
      const response = await apiFetch(`/api/activity/suggestions?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        await throwHttpError(
          response,
          `Failed to load activity suggestions: ${response.status}`,
        );
      }
      return ActivitySuggestionsResultSchema.parse(await response.json());
    },
    enabled: vault.length > 0,
    refetchOnMount: "always",
  });

  return query.data?.suggestions.length ?? 0;
}
