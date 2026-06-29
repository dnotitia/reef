"use client";

import { purgeAllExcept } from "@/features/issues/stores/issueEntityStore";
import { VAULT_NAME_RE } from "@/lib/akb/vaultName";
import {
  getActiveVault,
  setActiveVault as setActiveVaultDexie,
} from "@/lib/storage/config";
import { useHydrated } from "@/lib/useHydrated";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect } from "react";

export interface ActiveVaultState {
  /** akb vault name (e.g., "reef-acme"), or `""` when none selected. */
  vault: string;
  isLoading: boolean;
  refetch: () => Promise<unknown>;
}

export const ACTIVE_VAULT_QUERY_KEY = ["active-vault"] as const;

/**
 * Resolves the active workspace (akb vault). The URL is the source of truth:
 * the `/workspace/[vault]` path segment wins, and Dexie is demoted to the
 * "last viewed workspace" default for surfaces outside that segment — the root
 * redirector, the onboarding flow, and the `(legacy)` shim (REEF-315).
 *
 * Reading the vault from `useParams()` resolves it identically on the server
 * and the first client render (both see the URL), so a vault-scoped page no
 * longer rides the Dexie hydration gate that the `""`→cached-value swap below
 * still needs for the segment-less fallback.
 */
export function useActiveVault(): ActiveVaultState {
  const params = useParams();
  const rawParam = params?.vault;
  const urlVault =
    typeof rawParam === "string" && VAULT_NAME_RE.test(rawParam)
      ? rawParam
      : "";

  const query = useQuery({
    queryKey: ACTIVE_VAULT_QUERY_KEY,
    queryFn: getActiveVault,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  // Hydration gate for the Dexie fallback only. The server has no Dexie and no
  // persisted query cache, so it consistently renders vault="" / loading.
  // PersistQueryClientProvider restores the cached vault into `query.data`
  // synchronously, so reading it on the first client render would surface
  // "reef" while the server HTML said "" — a hydration mismatch that cascades
  // into every vault-derived view (KanbanBoard skeleton↔board,
  // AssigneeCombobox/PlanningItemCombobox disabled↔enabled). Gate on a mount
  // flag so the first client render matches the server, then swap to the real
  // value on the post-mount render. A URL-supplied vault skips this entirely —
  // it is identical on both passes.
  const hydrated = useHydrated();
  const dexieVault = hydrated ? (query.data ?? "") : "";

  return {
    vault: urlVault || dexieVault,
    // A URL vault is known synchronously, so it is never "loading". Otherwise
    // use isPending (not isLoading) so consumers stay "loading" during
    // PersistQueryClientProvider's restoration window. While isRestoring is
    // true, useQuery reports fetchStatus: 'idle' (gated subscription), which
    // makes isLoading false even though data is still undefined — callers
    // that gate skeletons on this would flash an empty state before the
    // hydrated cache arrives.
    isLoading: urlVault ? false : !hydrated || query.isPending,
    refetch: () => query.refetch(),
  };
}

/**
 * One-way URL→Dexie sync (REEF-315). Mounted once at the workspace layout, it
 * persists the URL's vault as the per-browser "last viewed workspace" default
 * and primes the active-vault query cache so segment-less Dexie-fallback
 * readers (root redirect, legacy shim) stay consistent. It deliberately does
 * NOT invalidate vault-scoped queries: the URL change already remounts the
 * subtree and rekeys every `[..., vault]` query, so a refetch happens without
 * the broad cache bust that the explicit switcher (`useSetActiveVault`) needs.
 */
export function useSyncActiveVaultFromUrl(vault: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!vault || !VAULT_NAME_RE.test(vault)) return;
    let cancelled = false;
    void (async () => {
      const current = await getActiveVault();
      if (cancelled) return;
      if (current !== vault) {
        await setActiveVaultDexie(vault);
        if (cancelled) return;
      }
      queryClient.setQueryData(ACTIVE_VAULT_QUERY_KEY, vault);
    })();
    return () => {
      cancelled = true;
    };
  }, [vault, queryClient]);
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
