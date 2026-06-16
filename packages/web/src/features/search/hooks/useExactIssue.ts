import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { IssueListItem } from "@reef/core";
import { useQuery } from "@tanstack/react-query";

/**
 * Look up a single issue by its exact id within the active vault — the ⌘K
 * palette's jump-to-id guarantee, used when the bounded `q` page didn't
 * already include the typed id.
 *
 * Deliberately distinct from `useIssue` (the detail view):
 *   - the query key includes the vault (`['issues','exact',vault,id]`), so a hit
 *     cached for another vault is does not served for the current one — issue ids
 *     are unique per vault, not globally;
 *   - `retry: false` and a 404 → `null` (not an error), so a not-found id (a
 *     half-typed prefix or a typo) costs exactly one request on this hot keyboard
 *     path instead of a retry storm or an error state to suppress;
 *   - `staleTime: 0`, so a cached row is consistently revalidated before it is trusted.
 *     This family is not wired into the issue mutations' invalidation, so without
 *     it an issue archived/deleted in this client could keep being merged into the
 *     palette from cache; revalidating means a now-archived/deleted id resolves to
 *     `null` (and selection stays blocked while the lookup is in flight).
 *
 * Returns the issue row, `null` when no issue has that id, or `undefined` while
 * loading / disabled. Disabled when either input is empty.
 */
export function useExactIssue(id: string, vault: string) {
  return useQuery({
    queryKey: ["issues", "exact", vault, id] as const,
    queryFn: async (): Promise<IssueListItem | null> => {
      const res = await apiFetch(
        `/api/issues/${encodeURIComponent(id)}?vault=${encodeURIComponent(vault)}`,
      );
      if (res.status === 404) return null;
      if (!res.ok) {
        await throwHttpError(res, `Failed to look up issue: ${res.status}`);
      }
      const body = (await res.json()) as { issue: IssueListItem };
      return body.issue;
    },
    enabled: !!id && !!vault,
    retry: false,
    staleTime: 0,
  });
}
