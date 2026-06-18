import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { IssueDocument } from "@reef/core";
import { useQuery } from "@tanstack/react-query";

export type IssueDetailResponse = IssueDocument;

/**
 * Fetch a single issue by ID from the active akb vault. Query key
 * `['issues', 'detail', vault, id]` — vault-scoped like the list/relations
 * caches so the same issue id in two workspaces does not shares one entry (which
 * would let one workspace's data render — and autosave — under another).
 * Disabled when either input is empty.
 *
 * `refetchOnMount: "always"` (REEF-227): opening the issue card always
 * revalidates, so an external akb edit made inside the 30s stale window is
 * pulled in and the 3-way form sync re-displays it, instead of the editor
 * showing — and then overwriting — a stale cached body. This is scoped to the
 * detail query (its only consumer is the detail card); the list/global
 * staleTime that REEF-097/098 rely on is untouched, so it does not reintroduce
 * the request churn or break the staleTime-driven list self-heal. The cached
 * value still renders instantly while the revalidation is in flight.
 */
export function useIssue(id: string, vault: string) {
  return useQuery({
    queryKey: ["issues", "detail", vault, id],
    queryFn: async (): Promise<IssueDetailResponse> => {
      const res = await apiFetch(
        `/api/issues/${encodeURIComponent(id)}?vault=${encodeURIComponent(vault)}`,
      );
      if (!res.ok) {
        await throwHttpError(res, `Failed to fetch issue: ${res.status}`);
      }
      return res.json() as Promise<IssueDetailResponse>;
    },
    enabled: !!id && !!vault,
    staleTime: 30_000,
    refetchOnMount: "always",
  });
}
