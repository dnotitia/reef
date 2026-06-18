"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { getConfigValue } from "@/lib/storage/config";
import {
  ActivitySuggestionsResultSchema,
  RecentActivityResultSchema,
} from "@reef/core";
import { useQuery } from "@tanstack/react-query";

const LAST_VISIT_AT_KEY = "last_visit_at";

export const UNREAD_INBOX_QUERY_KEY = ["unread-inbox"] as const;

/**
 * Returns the number of inbox items the PM has not yet seen since their last
 * Activity-page visit: pending AI suggestions (drafts + status changes) plus
 * recorded issue-change events (REEF-077). Suggestion and event state live in
 * AKB; `last_visit_at` stays browser-local because it is a per-user read marker.
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
      const suggestionParams = new URLSearchParams({
        vault,
        status: "pending",
      });
      const suggestionRes = await apiFetch(
        `/api/activity/suggestions?${suggestionParams}`,
      );
      if (!suggestionRes.ok) {
        await throwHttpError(
          suggestionRes,
          `Failed to load activity suggestions: ${suggestionRes.status}`,
        );
      }
      const { suggestions } = ActivitySuggestionsResultSchema.parse(
        await suggestionRes.json(),
      );
      const newSuggestions = suggestions.filter(
        (suggestion) => suggestion.created_at > lastVisit,
      ).length;

      // Recorded issue changes since the last visit. The server filters on
      // `since`, so every returned event is unseen — no client-side recount.
      // `events.length` is bounded by the feed page (100): the sidebar glyph
      // clamps to "9+" anyway, so the bound only caps the exact aria-label count
      // at >100 changes since a visit — an extreme case not worth a dedicated
      // count endpoint here.
      const eventParams = new URLSearchParams({ vault, since: lastVisit });
      const eventRes = await apiFetch(`/api/activity/events?${eventParams}`);
      if (!eventRes.ok) {
        await throwHttpError(
          eventRes,
          `Failed to load activity events: ${eventRes.status}`,
        );
      }
      const { events } = RecentActivityResultSchema.parse(
        await eventRes.json(),
      );

      return newSuggestions + events.length;
    },
    enabled: vault.length > 0,
    staleTime: 5_000,
  });
  return query.data ?? 0;
}
