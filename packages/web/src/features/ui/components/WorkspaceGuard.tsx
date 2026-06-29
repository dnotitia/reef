"use client";

import { AppShellSkeleton } from "@/components/AppShellSkeleton";
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

  // Membership gate (AC5) — no silent fallback. Hold the app-shell skeleton
  // until the vault list resolves rather than mounting DashboardShell, which
  // would fire vault-scoped fetches against a possibly-forbidden vault and
  // flash a member/non-member surface. A definitive non-member sees the
  // access-denied surface; a vaults-list error degrades open (the page's own
  // queries surface their errors) so a transient fetch failure does not lock a
  // real member out.
  if (vaultsQuery.isPending) {
    return <AppShellSkeleton />;
  }
  if (
    vaultsQuery.isSuccess &&
    !vaultsQuery.data.some((v) => v.name === vault)
  ) {
    return <WorkspaceAccessDenied vault={vault} vaults={vaultsQuery.data} />;
  }

  return <DashboardShell appVersion={appVersion}>{children}</DashboardShell>;
}
