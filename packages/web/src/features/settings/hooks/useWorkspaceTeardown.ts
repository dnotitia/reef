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
import { z } from "zod";

const InstallationStatusSchema = z.object({
  installation_status: z.literal("uninstalled"),
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The two workspace-lifecycle actions in Settings › Workspace: permanently
 * delete the whole AKB vault, or uninstall Reef while AKB retains its data. Both end
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
      (v) => v.name !== vault && v.installation_active === true,
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

  const uninstallReef = useMutation<void, Error, void>({
    mutationFn: async () => {
      const res = await apiFetch(
        `/api/vaults/${encodeURIComponent(vault)}/installation`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        await throwHttpError(res, `Failed to uninstall reef: ${res.status}`);
      }
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const statusResponse = await apiFetch(
          `/api/vaults/${encodeURIComponent(vault)}/installation`,
          { cache: "no-store" },
        );
        if (!statusResponse.ok) {
          await throwHttpError(
            statusResponse,
            `Failed to read installation status: ${statusResponse.status}`,
          );
        }
        const body: unknown = await statusResponse.json();
        if (InstallationStatusSchema.safeParse(body).success) return;
        await delay(1500);
      }
      throw new Error(t("uninstall.stillRunning"));
    },
    onSuccess: async () => {
      await onWorkspaceGone();
      toast.success(t("uninstall.success", { workspace: vault }));
    },
    onError: (err) => {
      toast.error(err.message || t("uninstall.failed"));
    },
  });

  return { deleteWorkspace, uninstallReef };
}
