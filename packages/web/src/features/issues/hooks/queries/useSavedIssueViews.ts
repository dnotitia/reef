import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { SavedIssueView } from "@reef/core";
import { queryOptions, useQuery } from "@tanstack/react-query";

export const savedIssueViewsKey = (vault: string) =>
  ["saved-issue-views", vault] as const;

export function savedIssueViewsQueryOptions(vault: string) {
  return queryOptions({
    queryKey: savedIssueViewsKey(vault),
    queryFn: async (): Promise<SavedIssueView[]> => {
      const response = await apiFetch(
        `/api/views?vault=${encodeURIComponent(vault)}`,
      );
      if (!response.ok) {
        await throwHttpError(
          response,
          `Failed to load saved views: ${response.status}`,
        );
      }
      return ((await response.json()) as { views: SavedIssueView[] }).views;
    },
    enabled: !!vault,
    // Team-shared rows can change in another tab or by another writer. Always
    // revalidate on mount; successful local mutations still update this exact
    // vault key immediately so the current surface does not flicker.
    staleTime: 0,
  });
}

export function useSavedIssueViews(vault: string) {
  return useQuery(savedIssueViewsQueryOptions(vault));
}
