"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { type VaultMember, VaultMemberSchema } from "@reef/core";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const RosterResponseSchema = z.object({
  members: z.array(VaultMemberSchema),
});

/** Hierarchical key for the role-bearing membership roster of a vault. */
export function vaultRosterKey(vault: string): readonly unknown[] {
  return ["vault-roster", vault] as const;
}

/**
 * The role-bearing membership roster for Settings → Workspace → Members
 * (REEF-179). Deliberately NOT gated on the viewer's role — readers may view
 * the list (AC1), and the role query (`useVaults`) runs in parallel, so member
 * management does not waits on a permission round-trip. Keyed separately from the
 * assignee typeahead's `['vault-members', …]` cache; grant/revoke invalidate
 * both so a membership change reflects in the roster and the assignee picker.
 */
export function useVaultRoster(vault: string) {
  return useQuery({
    queryKey: vaultRosterKey(vault),
    queryFn: async (): Promise<VaultMember[]> => {
      const res = await apiFetch(
        `/api/vaults/${encodeURIComponent(vault)}/members`,
      );
      if (!res.ok) {
        await throwHttpError(res, `Failed to load members: ${res.status}`);
      }
      const data = (await res.json()) as unknown;
      return RosterResponseSchema.parse(data).members;
    },
    enabled: !!vault,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
