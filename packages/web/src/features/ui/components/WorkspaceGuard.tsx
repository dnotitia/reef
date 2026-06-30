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

  // Session auth gate; membership is validated below against the vault list.
  useAuthRedirect("workspace");
  const vaultsQuery = useVaults();
  // A usable reef workspace is one the user can access AND that already carries
  // a reef config — the same `has_reef_config` bar the sidebar switcher and
  // onboarding use. A bare AKB vault the user merely belongs to is a dead end
  // (no issues/config surfaces), so treat it as not-a-workspace rather than
  // rendering an uninitialized board and persisting it as the default.
  const isMember =
    vaultsQuery.isSuccess &&
    vaultsQuery.data.some((v) => v.name === vault && v.has_reef_config);
  // One-way URL→Dexie sync: remember this vault as the "last viewed" default —
  // but for a confirmed member. Persisting before the membership check let
  // a well-formed but denied deep link (`/workspace/someone-else/...`) overwrite
  // the browser default, after which `/` and the flat-route shim would keep
  // redirecting into the inaccessible workspace. Passing "" while membership is
  // unknown or denied makes the sync a no-op.
  useSyncActiveVaultFromUrl(isMember ? vault : "");

  // Malformed segment → hard 404 (AC5). Thrown after the hooks above so hook
  // order is stable across renders.
  if (!VAULT_NAME_RE.test(vault)) notFound();

  // Membership gate (AC5) — no silent fallback, but render the shell
  // optimistically. The common case is a member, and gating every page load on
  // the vault-list fetch would serialize the whole workspace behind it (and is
  // unneeded once the list is cached). A confirmed non-member replaces the
  // shell with the explicit access-denied surface; while the list is still
  // loading, or if it errors, the shell renders and the page's own queries own
  // their loading/error states — a real member is not held back, and a
  // non-member still lands on access-denied once the list resolves.
  if (vaultsQuery.isSuccess && !isMember) {
    return <WorkspaceAccessDenied vault={vault} vaults={vaultsQuery.data} />;
  }

  return <DashboardShell appVersion={appVersion}>{children}</DashboardShell>;
}
