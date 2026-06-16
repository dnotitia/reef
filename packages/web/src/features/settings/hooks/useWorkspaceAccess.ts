"use client";

import { useVaults } from "./useVaults";

/**
 * akb vault roles allowed to EDIT team-shared workspace settings. The floor is
 * `writer` — the SAME boundary akb enforces on the underlying data writes — so
 * the UI gate matches the server-enforced boundary instead of advertising a
 * stricter one it does not back up (a reader is genuinely blocked by akb; a
 * writer is genuinely allowed). Readers see workspace settings read.
 *
 * This is the edit floor for the whole "Workspace" group in Settings,
 * generalizing the per-section gate that already lived in WorkspaceSkillSection.
 */
const WRITER_ROLES = new Set(["writer", "admin", "owner"]);

export interface WorkspaceAccess {
  /** The current user's role in the active vault, or null if unknown/unresolved. */
  role: string | null;
  /** True when the user may edit team-shared workspace settings. */
  canEditWorkspace: boolean;
  /** True while the vault role is still resolving — callers should not render a (wrong) badge yet. */
  isResolving: boolean;
}

/**
 * Derives the active user's workspace-edit permission from the vault role we
 * already hold via `useVaults()` (no extra request). Computed during render —
 * no effect, no local state — so it stays correct across role refetches.
 */
export function useWorkspaceAccess(vault: string): WorkspaceAccess {
  const vaultsQuery = useVaults();
  const role = vault
    ? (vaultsQuery.data?.find((v) => v.name === vault)?.role ?? null)
    : null;
  return {
    role,
    canEditWorkspace: role != null && WRITER_ROLES.has(role),
    isResolving: vaultsQuery.isPending,
  };
}
