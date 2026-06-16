import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { Collaborator } from "@reef/core";
import { useQuery } from "@tanstack/react-query";

/**
 * TanStack Query hook to look up workspace members in the active akb vault.
 *
 * Query key: ['vault-members', vault, query] — hierarchical by resource and query.
 * - Disabled when `vault` is empty (caller has no workspace selected yet)
 * - `query` filtering happens server-side against `username`/`display_name`
 *
 * Debounce is handled by the caller (AssigneeCombobox) — this hook is NOT
 * debounced. The 5-minute stale time mirrors the previous GitHub-backed hook;
 * vault membership rarely changes so cached results are safe to reuse.
 */
export function useUserSearch(query: string, vault: string) {
  return useQuery({
    queryKey: ["vault-members", vault, query],
    queryFn: async (): Promise<Collaborator[]> => {
      const params = new URLSearchParams({ vault });
      if (query.trim()) {
        params.set("q", query.trim());
      }
      const res = await apiFetch(`/api/vault-members?${params.toString()}`);
      if (!res.ok) {
        await throwHttpError(
          res,
          `Failed to load vault members: ${res.status}`,
        );
      }
      const body = (await res.json()) as { users: Collaborator[] };
      return body.users;
    },
    enabled: !!vault,
    staleTime: 5 * 60 * 1000,
  });
}
