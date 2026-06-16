import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { IssueRelation } from "@reef/core";
import { useQuery } from "@tanstack/react-query";

/**
 * The whole-vault relation projection (reef_id / status / depends_on) used for
 * blocker badges and the blocked/blocking dependency filter. Small payload, so
 * a generous staleTime. Query key `['issues', 'relations', vault]` — mutations
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
      const body = (await res.json()) as { relations: IssueRelation[] };
      return body.relations;
    },
    enabled: !!vault,
  });
}
