import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { IssueRelationsResponseSchema, type IssueRelation } from "@reef/core";
import { useQuery } from "@tanstack/react-query";

/**
 * The whole-vault compact relation projection used for blocker badges, the
 * blocked/blocking dependency filter, and Active Epic grouping. It carries
 * parent/title/type/rank metadata but no document body, so a generous staleTime
 * is appropriate. Query key `['issues', 'relations', vault]` — mutations
 * invalidate the `['issues']` prefix so this refreshes alongside the list.
 */
const issueRelationsKey = (vault: string) =>
  ["issues", "relations", vault] as const;

export function useIssueRelations(vault: string) {
  return useQuery({
    queryKey: issueRelationsKey(vault),
    staleTime: 60_000,
    queryFn: async (): Promise<IssueRelation[]> => {
      const res = await apiFetch(
        `/api/issues/relations?vault=${encodeURIComponent(vault)}`,
      );
      if (!res.ok) {
        await throwHttpError(res, `Failed to fetch relations: ${res.status}`);
      }
      return IssueRelationsResponseSchema.parse(await res.json()).relations;
    },
    enabled: !!vault,
  });
}
