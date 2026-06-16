import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  type ActivitySuggestion,
  ActivitySuggestionsResultSchema,
} from "@reef/core";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { ActivityFeedItem } from "../types";

export const ACTIVITY_SUGGESTIONS_QUERY_KEY = ["activity-suggestions"] as const;

/**
 * Stable descending comparator for ISO 8601 timestamp strings. Returns 0 for
 * equal timestamps so the underlying sort is stable.
 */
function compareTimestampDesc(a: string, b: string): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

/**
 * Assembles the merged chronological review inbox from AKB activity
 * suggestions.
 *
 * Derives two activity item types:
 *  - `ai_draft`         — pending draft suggestion awaiting PM review
 *  - `ai_status_change` — pending status-change suggestion awaiting PM review
 *
 * All items are merged and sorted by timestamp descending.
 */
export function useActivityFeed(vault: string): {
  items: ActivityFeedItem[];
  isLoading: boolean;
  refreshInbox: () => Promise<void>;
} {
  const query = useQuery({
    queryKey: [...ACTIVITY_SUGGESTIONS_QUERY_KEY, vault, "pending"],
    queryFn: async () => {
      const params = new URLSearchParams({ vault, status: "pending" });
      const res = await apiFetch(`/api/activity/suggestions?${params}`);
      if (!res.ok) {
        await throwHttpError(
          res,
          `Failed to load activity suggestions: ${res.status}`,
        );
      }
      return ActivitySuggestionsResultSchema.parse(await res.json());
    },
    enabled: vault.length > 0,
    staleTime: 5_000,
  });

  const refreshInbox = useCallback(async () => {
    await query.refetch();
  }, [query]);

  const items = useMemo<ActivityFeedItem[]>(() => {
    return (query.data?.suggestions ?? [])
      .map(suggestionToFeedItem)
      .sort((a, b) => compareTimestampDesc(a.timestamp, b.timestamp));
  }, [query.data?.suggestions]);

  return { items, isLoading: query.isLoading, refreshInbox };
}

function suggestionToFeedItem(
  suggestion: ActivitySuggestion,
): ActivityFeedItem {
  if (suggestion.kind === "draft") {
    return {
      id: suggestion.id,
      type: "ai_draft",
      timestamp: suggestion.created_at,
      draft: suggestion,
    };
  }
  return {
    id: suggestion.id,
    type: "ai_status_change",
    timestamp: suggestion.created_at,
    issueId: suggestion.proposal.update.issue_id,
    issueTitle: suggestion.issue_title,
    statusChange: suggestion,
  };
}
