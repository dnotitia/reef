"use client";

import { useAuthRedirect } from "@/features/auth/hooks/useAuthRedirect";
import { useSyncActiveVaultFromUrl } from "@/features/settings/hooks/useActiveVault";
import { useVaults } from "@/features/settings/hooks/useVaults";
import { VAULT_NAME_RE } from "@/lib/akb/vaultName";
import { notFound, useParams } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardShell } from "./DashboardShell";
import { WorkspaceAccessDenied } from "./WorkspaceAccessDenied";

interface WorkspaceGuardProps {
  appVersion: string;
  children: ReactNode;
}

/**
 * Gate for the `/workspace/[vault]` subtree (REEF-315). Replaces the old
 * `OnboardingGuard`: the vault now lives in the URL, so this guard
 *   1. runs the session-only auth gate (no Dexie-pointer bounce — a member who
 *      followed a shared link must not be sent to `/onboarding`),
 *   2. persists the URL vault as the per-browser "last viewed" default,
 *   3. 404s a malformed vault segment and shows an explicit access-denied
 *      surface for a well-formed vault the user is not a member of (AC5),
 *   4. renders the DashboardShell for an authorized vault.
 */
export function WorkspaceGuard({ appVersion, children }: WorkspaceGuardProps) {
  const params = useParams<{ vault: string }>();
  const vault = typeof params.vault === "string" ? params.vault : "";

  // Session-only gate; membership is validated below against the vault list.
  useAuthRedirect("workspace");
  // One-way URL→Dexie sync: remember this vault as the default for bare entries.
  useSyncActiveVaultFromUrl(vault);
  const vaultsQuery = useVaults();

  // Malformed segment → hard 404 (AC5). Thrown after the hooks above so hook
  // order is stable across renders.
  if (!VAULT_NAME_RE.test(vault)) notFound();

  // Membership gate (AC5) — no silent fallback, but render the shell
  // optimistically. The common case is a member, and gating every page load on
  // the vault-list fetch would serialize the whole workspace behind it (and is
  // unneeded once the list is cached). Only a DEFINITIVE non-member replaces the
  // shell with the explicit access-denied surface; while the list is still
  // loading, or if it errors, the shell renders and the page's own queries own
  // their loading/error states — a real member is never held back, and a
  // non-member still lands on access-denied once the list resolves.
  if (
    vaultsQuery.isSuccess &&
    !vaultsQuery.data.some((v) => v.name === vault)
  ) {
    return <WorkspaceAccessDenied vault={vault} vaults={vaultsQuery.data} />;
  }

  return <DashboardShell appVersion={appVersion}>{children}</DashboardShell>;
}
