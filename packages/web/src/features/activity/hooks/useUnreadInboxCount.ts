"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { getConfigValue } from "@/lib/storage/config";
import { ActivitySuggestionsResultSchema } from "@reef/core";
import { useQuery } from "@tanstack/react-query";

const LAST_VISIT_AT_KEY = "last_visit_at";

export const UNREAD_INBOX_QUERY_KEY = ["unread-inbox"] as const;

/**
 * Returns the number of pending inbox items created after the user's last
 * Activity-page visit. Suggestion state lives in AKB; `last_visit_at` remains
 * browser-local because it is a per-user read marker.
 *
 *  - A scan run finishes (DashboardShell invalidates on mutation success)
 *  - The user lands on /activity (ActivityFeed updates `last_visit_at` on
 *    mount; invalidation clears the badge)
 *  - A draft or note is approved or dismissed (ActivityFeed invalidates after
 *    the optimistic removal)
 *
 * Returns 0 while loading or on error so a transient failure does not shows a
 * misleading badge.
 */
export function useUnreadInboxCount(vault: string): number {
  const query = useQuery({
    queryKey: [...UNREAD_INBOX_QUERY_KEY, vault],
    queryFn: async () => {
      const lastVisit = await getConfigValue(LAST_VISIT_AT_KEY);
      if (!lastVisit) {
        // No prior visit recorded — the first-time-user case looks better with
        // a clean badge than a count derived from pending items the user has
        // does not had a chance to see.
        return 0;
      }
      const params = new URLSearchParams({ vault, status: "pending" });
      const res = await apiFetch(`/api/activity/suggestions?${params}`);
      if (!res.ok) {
        await throwHttpError(
          res,
          `Failed to load activity suggestions: ${res.status}`,
        );
      }
      const { suggestions } = ActivitySuggestionsResultSchema.parse(
        await res.json(),
      );
      return suggestions.filter(
        (suggestion) => suggestion.created_at > lastVisit,
      ).length;
    },
    enabled: vault.length > 0,
    staleTime: 5_000,
  });
  return query.data ?? 0;
}
