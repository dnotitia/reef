import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  type ActivitySuggestion,
  ActivitySuggestionsResultSchema,
  type RecentActivityEvent,
  RecentActivityResultSchema,
} from "@reef/core";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { ActivityFeedItem } from "../types";

export const ACTIVITY_SUGGESTIONS_QUERY_KEY = ["activity-suggestions"] as const;
export const ACTIVITY_EVENTS_QUERY_KEY = ["activity-events"] as const;

/**
 * Stable descending comparator for ISO 8601 timestamp strings. Returns 0 for
 * equal timestamps so the underlying sort is stable.
 */
function compareTimestampDesc(a: string, b: string): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

/**
 * Assembles the merged chronological Activity feed (REEF-077).
 *
 * Derives three activity item types:
 *  - `ai_draft`         — pending draft suggestion awaiting PM review
 *  - `ai_status_change` — pending status-change suggestion awaiting PM review
 *  - `issue_change`     — a recorded issue change (REEF-063 event), shown as an
 *                         informational item, not a reviewable proposal
 *
 * AI suggestions are the standing review inbox (bounded by their pending state).
 * Issue-change events are the "since you were last here" change stream, so they
 * are fetched only when an `eventsSince` marker is known (the page's captured
 * `last_visit_at`); on a first visit, with no marker, the feed shows none —
 * consistent with the unread badge. All items are merged and sorted descending.
 */
export function useActivityFeed(
  vault: string,
  eventsSince?: string,
): {
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

  const eventsQuery = useQuery({
    queryKey: [...ACTIVITY_EVENTS_QUERY_KEY, vault, eventsSince ?? null],
    queryFn: async () => {
      const params = new URLSearchParams({ vault });
      if (eventsSince) params.set("since", eventsSince);
      const res = await apiFetch(`/api/activity/events?${params}`);
      if (!res.ok) {
        await throwHttpError(
          res,
          `Failed to load activity events: ${res.status}`,
        );
      }
      return RecentActivityResultSchema.parse(await res.json());
    },
    // Only fetch the change stream once the page has captured `last_visit_at`.
    enabled: vault.length > 0 && eventsSince !== undefined,
    staleTime: 5_000,
  });

  const refreshInbox = useCallback(async () => {
    await query.refetch();
  }, [query]);

  const items = useMemo<ActivityFeedItem[]>(() => {
    const suggestionItems = (query.data?.suggestions ?? []).map(
      suggestionToFeedItem,
    );
    const eventItems = (eventsQuery.data?.events ?? []).map(eventToFeedItem);
    return [...suggestionItems, ...eventItems].sort((a, b) =>
      compareTimestampDesc(a.timestamp, b.timestamp),
    );
  }, [query.data?.suggestions, eventsQuery.data?.events]);

  return {
    items,
    isLoading: query.isLoading || eventsQuery.isLoading,
    refreshInbox,
  };
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

function eventToFeedItem(event: RecentActivityEvent): ActivityFeedItem {
  return {
    // Namespace the akb event uuid so it never collides with a suggestion id in
    // the merged list's React keys / removed-id set.
    id: `event:${event.id}`,
    type: "issue_change",
    timestamp: event.at,
    issueId: event.reef_id,
    issueTitle: event.issue_title,
    event,
  };
}
