"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { type VaultSkillStatus, VaultSkillStatusSchema } from "@reef/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applyWorkspaceSkillUpdate } from "../workspaceSkill.actions";

function skillStatusKey(vault: string) {
  return ["vault-skill", vault] as const;
}

/**
 * Reads the vault's agent-playbook version status (installed vs current). The
 * comparison itself is server-derived (`up_to_date`); this hook renders
 * the result. Keyed by vault so a workspace switch refetches.
 */
export function useWorkspaceSkillStatus(vault: string) {
  return useQuery({
    queryKey: skillStatusKey(vault),
    enabled: vault.length > 0,
    queryFn: async (): Promise<VaultSkillStatus> => {
      const res = await apiFetch(
        `/api/vaults/${encodeURIComponent(vault)}/skill`,
      );
      if (!res.ok) {
        await throwHttpError(res, `Failed to load skill status: ${res.status}`);
      }
      return VaultSkillStatusSchema.parse((await res.json()) as unknown);
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/**
 * Applies the workspace skill update and primes the status cache with the
 * returned status, so the section flips to "up to date" without a refetch.
 */
export function useApplyWorkspaceSkillUpdate(vault: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => applyWorkspaceSkillUpdate(vault),
    onSuccess: (status) => {
      queryClient.setQueryData(skillStatusKey(vault), status);
    },
  });
}
