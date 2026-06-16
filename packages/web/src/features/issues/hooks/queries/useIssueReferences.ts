import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { AkbDocumentReference } from "@reef/core";
import { useQuery } from "@tanstack/react-query";

/** Hierarchical query key for an issue's akb document references. */
export function issueReferencesKey(vault: string, issueId: string) {
  return ["issues", "references", vault, issueId] as const;
}

/**
 * The akb-native `references` edges from an issue's document to akb documents
 * (REEF-083) — the issue detail's Linked documents section. Query key
 * `['issues', 'references', vault, id]`; disabled until both inputs exist.
 */
export function useIssueReferences(issueId: string, vault: string) {
  return useQuery({
    queryKey: issueReferencesKey(vault, issueId),
    queryFn: async (): Promise<AkbDocumentReference[]> => {
      const res = await apiFetch(
        `/api/issues/${encodeURIComponent(issueId)}/references?vault=${encodeURIComponent(vault)}`,
      );
      if (!res.ok) {
        await throwHttpError(res, `Failed to load references: ${res.status}`);
      }
      const body = (await res.json()) as { references: AkbDocumentReference[] };
      return body.references;
    },
    enabled: !!issueId && !!vault,
    staleTime: 30_000,
  });
}
