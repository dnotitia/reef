"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { VaultMember } from "@reef/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { vaultRosterKey } from "./useVaultRoster";

export interface GrantMemberArgs {
  /** akb username to grant or re-role. */
  user: string;
  role: "reader" | "writer" | "admin";
  /** Known display name (from the directory pick or the existing row) for the
   *  optimistic row — the grant response does not echo it. */
  displayName?: string | null;
}

interface GrantContext {
  previous: VaultMember[] | undefined;
}

/**
 * Grant or re-role a member with an optimistic roster update (REEF-179). One
 * mutation instance lives per row / per add-form so its `isPending` stays local
 * and a memoized `MemberRow` re-renders just its own row, not the whole list.
 *
 * On settle it invalidates BOTH the roster and the assignee-typeahead cache so a
 * membership change is reflected wherever members are listed. The akb grant is
 * an upsert, so the same path covers both "add" (new row) and "change role"
 * (patch existing row).
 */
export function useGrantMember(vault: string) {
  const queryClient = useQueryClient();
  const key = vaultRosterKey(vault);

  return useMutation<void, Error, GrantMemberArgs, GrantContext>({
    mutationFn: async ({ user, role }) => {
      const res = await apiFetch(
        `/api/vaults/${encodeURIComponent(vault)}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user, role }),
        },
      );
      if (!res.ok) {
        await throwHttpError(res, `Failed to update member: ${res.status}`);
      }
    },
    onMutate: async ({ user, role, displayName }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<VaultMember[]>(key);
      queryClient.setQueryData<VaultMember[]>(key, (current = []) => {
        const existing = current.find((m) => m.username === user);
        if (existing) {
          return current.map((m) => (m.username === user ? { ...m, role } : m));
        }
        return [
          ...current,
          { username: user, role, display_name: displayName ?? null },
        ];
      });
      return { previous };
    },
    onError: (_err, _args, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["vault-members", vault] });
    },
  });
}
