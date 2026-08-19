import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { IssueBodyHistoryEvent } from "@reef/core";
import { useQuery } from "@tanstack/react-query";

export function issueBodyHistoryKey(vault: string, issueId: string) {
  return ["issues", "body-history", vault, issueId] as const;
}

/** Load read-time issue document body updates from the AKB history route. */
export function useIssueBodyHistory(issueId: string, vault: string) {
  return useQuery({
    queryKey: issueBodyHistoryKey(vault, issueId),
    queryFn: async (): Promise<IssueBodyHistoryEvent[]> => {
      const res = await apiFetch(
        `/api/issues/${encodeURIComponent(issueId)}/history?vault=${encodeURIComponent(
          vault,
        )}`,
      );
      if (!res.ok) {
        await throwHttpError(
          res,
          `Failed to load issue body history: ${res.status}`,
        );
      }
      const body = (await res.json()) as {
        history?: IssueBodyHistoryEvent[];
      };
      return body.history ?? [];
    },
    enabled: !!issueId && !!vault,
    staleTime: 30_000,
  });
}
