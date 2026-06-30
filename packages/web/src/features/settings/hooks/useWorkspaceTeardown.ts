"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { withVault } from "@/lib/workspaceHref";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";
import { useSetActiveVault } from "./useActiveVault";
import { useVaults } from "./useVaults";

/**
 * The two destructive workspace-lifecycle actions in Settings › Workspace
 * (REEF-322): permanently delete the whole akb vault, or remove just the reef
 * layer (detach) and leave the vault and its non-reef content intact. Both end
 * the same way — the active vault is no longer a usable reef workspace — so they
 * share one success path: invalidate the vault list, switch the active vault to
 * the next reef workspace (or none → onboarding), navigate, and toast.
 */
export function useWorkspaceTeardown(vault: string) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const setActiveVault = useSetActiveVault();
  const vaultsQuery = useVaults();
  const t = useTranslations("settings.dangerZone");

  // Choose the destination BEFORE the list refetches: the other vaults are
  // unaffected by removing this one, so the current snapshot is enough to pick a
  // remaining reef workspace (or fall back to onboarding when none is left).
  const onWorkspaceGone = useCallback(async () => {
    const next = (vaultsQuery.data ?? []).find(
      (v) => v.name !== vault && v.has_reef_config,
    );
    await queryClient.invalidateQueries({ queryKey: ["vaults"] });
    await setActiveVault.mutateAsync(next?.name ?? "");
    router.push(next ? withVault(next.name, "/issues") : "/onboarding");
  }, [vault, vaultsQuery.data, queryClient, setActiveVault, router]);

  const deleteWorkspace = useMutation<void, Error, void>({
    mutationFn: async () => {
      const res = await apiFetch(`/api/vaults/${encodeURIComponent(vault)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        await throwHttpError(res, `Failed to delete workspace: ${res.status}`);
      }
    },
    onSuccess: async () => {
      await onWorkspaceGone();
      toast.success(t("delete.success", { workspace: vault }));
    },
    onError: (err) => {
      toast.error(err.message || t("delete.failed"));
    },
  });

  const detachReef = useMutation<void, Error, void>({
    mutationFn: async () => {
      const res = await apiFetch(
        `/api/vaults/${encodeURIComponent(vault)}/reef`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        await throwHttpError(res, `Failed to remove reef: ${res.status}`);
      }
    },
    onSuccess: async () => {
      await onWorkspaceGone();
      toast.success(t("detach.success", { workspace: vault }));
    },
    onError: (err) => {
      toast.error(err.message || t("detach.failed"));
    },
  });

  return { deleteWorkspace, detachReef };
}
