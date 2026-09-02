import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { useHydrated } from "@/lib/useHydrated";
import { type IssueListResponse, IssueListResponseSchema } from "@reef/core";
import { type InfiniteData, useInfiniteQuery } from "@tanstack/react-query";
import {
  type IssueQueryParams,
  appendIssueQueryParams,
} from "../../lib/buildIssueQuery";
import { issueListInfiniteKey } from "../../lib/issueListCache";

const ISSUE_LIST_PAGE_SIZE = 100;

export function useInfiniteIssueList(vault: string, query: IssueQueryParams) {
  const hydrated = useHydrated();
  const result = useInfiniteQuery<
    IssueListResponse,
    Error,
    InfiniteData<IssueListResponse, string | null>,
    ReturnType<typeof issueListInfiniteKey>,
    string | null
  >({
    queryKey: issueListInfiniteKey(vault, query),
    initialPageParam: null as string | null,
    staleTime: 60_000,
    // Revalidate persisted snapshots on reload/remount so a fresh empty page
    // cannot mask a current server read failure (V7).
    refetchOnMount: "always",
    retry: false,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[2] === vault &&
      previousQuery?.queryKey[3] === "infinite"
        ? previousData
        : undefined,
    queryFn: async ({ pageParam }): Promise<IssueListResponse> => {
      const params = new URLSearchParams();
      params.set("vault", vault);
      params.set("limit", String(ISSUE_LIST_PAGE_SIZE));
      if (pageParam) params.set("cursor", pageParam);
      appendIssueQueryParams(params, query);

      const res = await apiFetch(`/api/issues?${params.toString()}`);
      if (!res.ok) {
        await throwHttpError(res, `Failed to fetch issues: ${res.status}`);
      }
      return IssueListResponseSchema.parse(await res.json());
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: !!vault,
  });

  if (!hydrated) {
    return {
      ...result,
      data: undefined,
      error: null,
      isPending: true,
      isLoading: false,
      isLoadingError: false,
      isRefetchError: false,
      isSuccess: false,
      isError: false,
      status: "pending",
      fetchStatus: "idle",
    } as typeof result;
  }
  return result;
}
