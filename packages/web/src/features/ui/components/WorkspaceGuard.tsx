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
 *   1. runs the session auth gate (no Dexie-pointer bounce — a member who
 *      followed a shared link should not be sent to `/onboarding`),
 *   2. persists the URL vault as the per-browser "last viewed" default after
 *      membership is confirmed (a denied deep link should not poison the default),
 *   3. 404s a malformed vault segment and shows an explicit access-denied
 *      surface for a well-formed vault the user is not a member of (AC5),
 *   4. renders the DashboardShell for an authorized vault.
 */
export function WorkspaceGuard({ appVersion, children }: WorkspaceGuardProps) {
  const params = useParams<{ vault: string }>();
  const vault = typeof params.vault === "string" ? params.vault : "";

  // Keep the protected tree unmounted until `/auth/me` confirms the session.
  // Otherwise its parallel queries can consume and clear an account-denial
  // cookie before this guard preserves the stable AKB denial code.
  const authStatus = useAuthRedirect("workspace");

  // Malformed segment → hard 404. The auth hook above remains unconditional so
  // hook order is stable across route changes.
  if (!VAULT_NAME_RE.test(vault)) notFound();

  const vaultsQuery = useVaults({ enabled: authStatus === "active" });
  // A usable reef workspace is one the user can access AND that already carries
  // a reef config — the same `has_reef_config` bar the sidebar switcher and
  // onboarding use. A bare AKB vault the user merely belongs to is a dead end
  // (no issues/config surfaces), so treat it as not-a-workspace rather than
  // rendering an uninitialized board and persisting it as the default.
  const isMember =
    authStatus === "active" &&
    vaultsQuery.isSuccess &&
    vaultsQuery.data.some((v) => v.name === vault && v.has_reef_config);
  // One-way URL→Dexie sync: remember this vault as the per-browser default
  // only after auth and membership are confirmed. Passing "" while the
  // session or membership is unknown makes the sync a no-op.
  useSyncActiveVaultFromUrl(isMember ? vault : "");

  if (authStatus !== "active") {
    return <AppShellSkeleton />;
  }

  // Keep the access-denied surface outside the dashboard shell so its
  // dedicated account utility and recovery layout stay unchanged.
  if (authStatus === "active" && vaultsQuery.isSuccess && !isMember) {
    return (
      <WorkspaceAccessDenied
        appVersion={appVersion}
        vault={vault}
        vaults={vaultsQuery.data}
      />
    );
  }

  return <DashboardShell appVersion={appVersion}>{children}</DashboardShell>;
}
