import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { DocumentSearchHit } from "@reef/core";
import { useQuery } from "@tanstack/react-query";

const SEARCH_LIMIT = 12;

/**
 * Look up akb documents in the active vault for the issue document-reference
 * picker (REEF-083).
 *
 * Query key: ['document-search', vault, query] — hierarchical by resource and
 * query. Unlike the issue combobox there is no "recent" empty state: akb's
 * search term is required, so the query is DISABLED until the caller has typed
 * something. Debounce is the caller's responsibility (DocumentRefInput), mirroring
 * how AssigneeCombobox drives `useUserSearch`.
 */
export function useVaultDocumentSearch(query: string, vault: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["document-search", vault, trimmed],
    queryFn: async (): Promise<DocumentSearchHit[]> => {
      const params = new URLSearchParams({
        vault,
        q: trimmed,
        limit: String(SEARCH_LIMIT),
      });
      const res = await apiFetch(`/api/documents/search?${params.toString()}`);
      if (!res.ok) {
        await throwHttpError(res, `Document search failed: ${res.status}`);
      }
      const body = (await res.json()) as { documents: DocumentSearchHit[] };
      return body.documents;
    },
    enabled: !!vault && trimmed.length > 0,
    staleTime: 60_000,
  });
}
