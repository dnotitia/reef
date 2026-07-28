import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  IssueContentSearchRequestSchema,
  type IssueContentSearchResponse,
  IssueContentSearchResponseSchema,
} from "@reef/core";
import { useQuery } from "@tanstack/react-query";

export interface IssueContentSearchData extends IssueContentSearchResponse {
  query: string;
  limit: number;
}

export function useIssueContentSearch(
  query: string,
  vault: string,
  limit: number,
) {
  const trimmedQuery = query.trim();
  const isValidRequest = IssueContentSearchRequestSchema.safeParse({
    q: trimmedQuery,
    limit,
  }).success;
  return useQuery({
    queryKey: ["issues", "search-content", vault, trimmedQuery, limit] as const,
    queryFn: async (): Promise<IssueContentSearchData> => {
      const params = new URLSearchParams({
        vault,
        q: trimmedQuery,
        limit: String(limit),
      });
      const response = await apiFetch(
        `/api/issues/search-content?${params.toString()}`,
      );
      if (!response.ok) {
        await throwHttpError(
          response,
          `Failed to search issue content: ${response.status}`,
        );
      }
      const parsed = IssueContentSearchResponseSchema.parse(
        await response.json(),
      );
      return { ...parsed, query: trimmedQuery, limit };
    },
    enabled: !!vault && isValidRequest,
    retry: false,
    staleTime: 0,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      return previousKey?.[2] === vault && previousKey?.[3] === trimmedQuery
        ? previousData
        : undefined;
    },
  });
}
