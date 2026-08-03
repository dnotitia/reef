"use client";

import type { ActivitySuggestion, ActivitySuggestionsResult } from "@reef/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  type UpdateActivitySuggestionPatch,
  approveActivitySuggestion,
  dismissActivitySuggestion,
  updateActivitySuggestion,
} from "../actions/activitySuggestions.actions";
import { activitySuggestionsQueryKey } from "./useActivityFeed";

type SuggestionQueryKey = ReturnType<typeof activitySuggestionsQueryKey>;

function replacePendingSuggestion(
  current: ActivitySuggestionsResult | undefined,
  suggestion: ActivitySuggestion,
): ActivitySuggestionsResult | undefined {
  if (!current) return current;

  const suggestions =
    suggestion.status === "pending"
      ? current.suggestions.some((item) => item.id === suggestion.id)
        ? current.suggestions.map((item) =>
            item.id === suggestion.id ? suggestion : item,
          )
        : [...current.suggestions, suggestion]
      : current.suggestions.filter((item) => item.id !== suggestion.id);

  return { ...current, suggestions };
}

async function invalidatePendingSuggestions(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: SuggestionQueryKey,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey, exact: true });
}

async function reconcilePendingSuggestion(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: SuggestionQueryKey,
  suggestion: ActivitySuggestion,
): Promise<void> {
  queryClient.setQueryData<ActivitySuggestionsResult>(queryKey, (current) =>
    replacePendingSuggestion(current, suggestion),
  );
  await invalidatePendingSuggestions(queryClient, queryKey).catch(() => {
    // The mutation response is authoritative for this review action; a
    // failed background refetch should not turn a successful action into an
    // error after the pending cache has already been reconciled.
  });
}

async function invalidateIssueCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  vault: string,
  issueId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: ["issues", "detail", vault, issueId],
      exact: true,
    }),
    queryClient.invalidateQueries({
      queryKey: ["issues", "list", vault],
      exact: true,
    }),
    queryClient.invalidateQueries({
      queryKey: ["issues", "relations", vault],
      exact: true,
    }),
  ]).catch(() => {
    // Status approval is already persisted; list/detail refresh is best effort.
  });
}

/**
 * Shared mutation boundary for the pending activity-suggestions query.
 * Central Suggestions and issue detail both use this hook so a review removes
 * or updates the same pending cache entry before its authoritative refetch.
 */
export function useActivitySuggestionReview(vault: string) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => activitySuggestionsQueryKey(vault), [vault]);

  const revalidateAfterFailure = useCallback(async () => {
    await invalidatePendingSuggestions(queryClient, queryKey).catch(() => {
      // Keep the original mutation error as the user-facing failure.
    });
  }, [queryClient, queryKey]);

  const updateSuggestion = useCallback(
    async (id: string, patch: UpdateActivitySuggestionPatch) => {
      try {
        const result = await updateActivitySuggestion(id, vault, patch);
        await reconcilePendingSuggestion(
          queryClient,
          queryKey,
          result.suggestion,
        );
        return result;
      } catch (error) {
        await revalidateAfterFailure();
        throw error;
      }
    },
    [queryClient, queryKey, revalidateAfterFailure, vault],
  );

  const dismissSuggestion = useCallback(
    async (id: string) => {
      try {
        const result = await dismissActivitySuggestion(id, vault);
        await reconcilePendingSuggestion(
          queryClient,
          queryKey,
          result.suggestion,
        );
        return result;
      } catch (error) {
        await revalidateAfterFailure();
        throw error;
      }
    },
    [queryClient, queryKey, revalidateAfterFailure, vault],
  );

  const approveSuggestion = useCallback(
    async (id: string, prefix?: string) => {
      try {
        const result = await approveActivitySuggestion(id, {
          vault,
          ...(prefix ? { prefix } : {}),
        });
        await reconcilePendingSuggestion(
          queryClient,
          queryKey,
          result.suggestion,
        );
        if (result.suggestion.kind === "status_change") {
          await invalidateIssueCaches(
            queryClient,
            vault,
            result.suggestion.proposal.update.issue_id,
          );
        }
        return result;
      } catch (error) {
        await revalidateAfterFailure();
        throw error;
      }
    },
    [queryClient, queryKey, revalidateAfterFailure, vault],
  );

  return { updateSuggestion, dismissSuggestion, approveSuggestion };
}
