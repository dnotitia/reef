"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { VaultMember } from "@reef/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { vaultRosterKey } from "./useVaultRoster";

interface RevokeContext {
  previous: VaultMember[] | undefined;
}

/**
 * Revoke a member with an optimistic removal from the roster (REEF-179). On
 * settle it invalidates the roster and the assignee-typeahead cache so the
 * removed member disappears from both. Owner/self rows does not reach this — the
 * UI keeps them un-removable — so the akb owner-revoke 403 is just a backstop.
 */
export function useRevokeMember(vault: string) {
  const queryClient = useQueryClient();
  const key = vaultRosterKey(vault);

  return useMutation<void, Error, string, RevokeContext>({
    mutationFn: async (user) => {
      const res = await apiFetch(
        `/api/vaults/${encodeURIComponent(vault)}/members/${encodeURIComponent(user)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        await throwHttpError(res, `Failed to remove member: ${res.status}`);
      }
    },
    onMutate: async (user) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<VaultMember[]>(key);
      queryClient.setQueryData<VaultMember[]>(key, (current = []) =>
        current.filter((m) => m.username !== user),
      );
      return { previous };
    },
    onError: (_err, _user, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["vault-members", vault] });
    },
  });
}
