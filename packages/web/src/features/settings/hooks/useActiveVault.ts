"use client";

import { purgeAllExcept } from "@/features/issues/stores/issueEntityStore";
import {
  getActiveVault,
  setActiveVault as setActiveVaultDexie,
} from "@/lib/storage/config";
import { useHydrated } from "@/lib/useHydrated";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface ActiveVaultState {
  /** akb vault name (e.g., "reef-acme"), or `""` when none selected. */
  vault: string;
  isLoading: boolean;
  refetch: () => Promise<unknown>;
}

const ACTIVE_VAULT_QUERY_KEY = ["active-vault"] as const;

/**
 * Reads the per-user "which workspace am I viewing" pointer from Dexie.
 * Routed through TanStack Query so siblings stay in sync after
 * `useSetActiveVault` writes — without this they'd hold the value read at
 * their own mount time and write to the wrong vault.
 */
export function useActiveVault(): ActiveVaultState {
  const query = useQuery({
    queryKey: ACTIVE_VAULT_QUERY_KEY,
    queryFn: getActiveVault,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  // Hydration gate. The server has no Dexie and no persisted query cache, so
  // it consistently renders vault="" / loading. PersistQueryClientProvider restores
  // the cached vault into `query.data` synchronously, so reading it on the
  // first client render would surface "reef" while the server HTML said "" —
  // a hydration mismatch that cascades into every vault-derived view
  // (KanbanBoard skeleton↔board, AssigneeCombobox/PlanningItemCombobox
  // disabled↔enabled). Gate on a mount flag so the first client render
  // matches the server, then swap to the real value on the post-mount render.
  const hydrated = useHydrated();

  return {
    vault: hydrated ? (query.data ?? "") : "",
    // isPending (not isLoading) so consumers stay "loading" during
    // PersistQueryClientProvider's restoration window. While isRestoring is
    // true, useQuery reports fetchStatus: 'idle' (gated subscription), which
    // makes isLoading false even though data is still undefined — callers
    // that gate skeletons on this would flash an empty state before the
    // hydrated cache arrives.
    isLoading: !hydrated || query.isPending,
    refetch: () => query.refetch(),
  };
}

export function useSetActiveVault() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vault: string) => {
      await setActiveVaultDexie(vault);
      return vault;
    },
    onSuccess: (vault) => {
      queryClient.setQueryData(ACTIVE_VAULT_QUERY_KEY, vault);
      // The vault switch invalidates everything keyed by it — config first,
      // then issue lists/details/templates that depend on it.
      void queryClient.invalidateQueries({ queryKey: ["config"] });
      void queryClient.invalidateQueries({ queryKey: ["issues"] });
      void queryClient.invalidateQueries({ queryKey: ["issue-templates"] });
      void queryClient.invalidateQueries({ queryKey: ["planning"] });
      // Drop other workspaces' entities from the normalized store; the new
      // vault's entries are refetched and re-normalized by the invalidation
      // above. Structural `byVault` isolation already prevents cross-vault
      // reads — this just bounds memory to the active workspace.
      purgeAllExcept(vault);
    },
  });
}
