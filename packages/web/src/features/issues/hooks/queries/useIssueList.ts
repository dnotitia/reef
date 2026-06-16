import {
  type IssueQueryParams,
  appendIssueQueryParams,
  normalizeIssueQuery,
} from "@/features/issues/lib/buildIssueQuery";
import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { IssueListItem } from "@reef/core";
import { useQuery } from "@tanstack/react-query";

/**
 * List issues in the active akb vault, optionally narrowed server-side by
 * `query` (status/priority/assignee/search/sort/...). Query key
 * `['issues', 'list', vault]` (full list) or `['issues', 'list', vault, <query>]`
 * (filtered) — the `['issues', 'list', vault]` prefix still matches both, so
 * mutation invalidation keeps working. akb does not surface response ETags yet,
 * so refreshes are unconditional.
 */
const issueListKey = (vault: string) => ["issues", "list", vault] as const;

export function useIssueList(vault: string, query?: IssueQueryParams) {
  return useQuery({
    queryKey: query
      ? (["issues", "list", vault, normalizeIssueQuery(query)] as const)
      : issueListKey(vault),
    staleTime: 60_000,
    // Keep prior results visible across filter/sort changes WITHIN the same
    // vault (no skeleton flicker), but does not across a workspace switch — that
    // would briefly show another vault's issues.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[2] === vault ? previousData : undefined,
    queryFn: async (): Promise<IssueListItem[]> => {
      const params = new URLSearchParams();
      params.set("vault", vault);
      if (query) appendIssueQueryParams(params, query);
      const res = await apiFetch(`/api/issues?${params.toString()}`);
      if (!res.ok) {
        await throwHttpError(res, `Failed to fetch issues: ${res.status}`);
      }
      const body = (await res.json()) as { issues: IssueListItem[] };
      return body.issues;
    },
    enabled: !!vault,
  });
}
