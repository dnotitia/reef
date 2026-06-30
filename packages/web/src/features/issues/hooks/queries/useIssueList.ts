import {
  type IssueQueryParams,
  appendIssueQueryParams,
  normalizeIssueQuery,
} from "@/features/issues/lib/buildIssueQuery";
import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { useHydrated } from "@/lib/useHydrated";
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

export function useIssueList(
  vault: string,
  query?: IssueQueryParams,
  options?: {
    /**
     * Reuse the previous query's rows as placeholder while a new query key
     * fetches WITHIN the same vault (no skeleton flicker on filter/sort changes).
     * Default true. Set false for an identity-scoped query (My Work) where the
     * key changes on an account switch — reusing the previous login's rows
     * as placeholder would briefly show another user's work in the same vault
     * (REEF-267 autoreview). With it off, a login change shows a skeleton, not
     * stale rows.
     */
    keepPreviousData?: boolean;
  },
) {
  const keepPreviousData = options?.keepPreviousData ?? true;
  const hydrated = useHydrated();
  const result = useQuery({
    queryKey: query
      ? (["issues", "list", vault, normalizeIssueQuery(query)] as const)
      : issueListKey(vault),
    staleTime: 60_000,
    // Keep prior results visible across filter/sort changes WITHIN the same
    // vault (no skeleton flicker), but does not across a workspace switch — that
    // would briefly show another vault's issues. An identity-scoped caller opts
    // out via `keepPreviousData: false` so an account change does not reuse the
    // previous login's rows (see the option doc above).
    placeholderData: keepPreviousData
      ? (previousData, previousQuery) =>
          previousQuery?.queryKey[2] === vault ? previousData : undefined
      : undefined,
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

  // Hydration gate. The server renders the pending skeleton because it has no
  // persisted query cache; PersistQueryClientProvider rehydrates that cache into
  // `result` on the client. Surfacing the restored rows on the first (hydration)
  // client render would mismatch the server's skeleton and cascade through every
  // isPending-branching issue view (board / list / backlog / timeline / reports
  // / my-work) plus the data-readers that key off the same query (parent
  // breadcrumb, sidebar attention badge). Hold the SSR-shaped pending result for
  // the hydration render, then reveal the cache on the post-mount render. This
  // mirrors the useActiveVault hydration gate; REEF-315 dropped the incidental
  // vault="" gate that used to cover this before the URL supplied the vault
  // synchronously on the first client render. `enabled` alone cannot do this — a
  // disabled query still returns whatever the persister already restored.
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
