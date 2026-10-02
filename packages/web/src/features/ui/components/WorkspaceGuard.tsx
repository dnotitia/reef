"use client";

import {
  retryAuthSession,
  useAuthRedirect,
} from "@/features/auth/hooks/useAuthRedirect";
import { AuthVerificationFallback } from "@/features/auth/components/AuthVerificationFallback";
import { useSyncActiveVaultFromUrl } from "@/features/settings/hooks/useActiveVault";
import { useVaults } from "@/features/settings/hooks/useVaults";
import { IssueDetailAuthPendingSkeleton } from "@/features/issues/components/detail/IssueDetailAuthPendingSkeleton";
import { IssueDetailEntryHandoffProvider } from "@/features/issues/components/detail/IssueDetailEntryHandoff";
import { BlockedWorkspaceInstallationSettings } from "@/features/settings/components/BlockedWorkspaceInstallationSettings";
import { hasEstablishedAuthSession } from "@/lib/akb/authCoordinator";
import { VAULT_NAME_RE } from "@/lib/akb/vaultName";
import { withVault } from "@/lib/workspaceHref";
import {
  notFound,
  useParams,
  usePathname,
  useSearchParams,
} from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DashboardShell } from "./DashboardShell";
import { WorkspaceAccessDenied } from "./WorkspaceAccessDenied";
import { WorkspaceAuthPendingSkeleton } from "./WorkspaceAuthPendingSkeleton";

interface WorkspaceGuardProps {
  appVersion: string;
  children: ReactNode;
}

function directIssueDetailId(pathname: string | null): string | null {
  const segments = (pathname ?? "").split("/").filter(Boolean);
  const workspaceIndex = segments.indexOf("workspace");
  if (
    workspaceIndex === -1 ||
    segments.length !== workspaceIndex + 4 ||
    segments[workspaceIndex + 2] !== "issues"
  ) {
    return null;
  }
  return segments[workspaceIndex + 3] ?? null;
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [authPendingPathname, setAuthPendingPathname] = useState<string | null>(
    null,
  );
  const completeAuthHandoff = useCallback(
    () => setAuthPendingPathname(null),
    [],
  );

  // Keep a cold protected tree unmounted until `/auth/me` confirms the session.
  // Once established, an unavailable background check keeps the mounted tree
  // in place so transient failures do not discard the user's current work.
  const authStatus = useAuthRedirect("workspace");
  const establishedAuthSession = hasEstablishedAuthSession();
  const canRenderAuthenticatedTree =
    authStatus === "active" ||
    (authStatus === "unavailable" && establishedAuthSession);

  useEffect(() => {
    if (!canRenderAuthenticatedTree) {
      // Record the route whose authenticated children are still gated so a
      // direct issue entry can keep its static panel through this handoff.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- auth transition boundary
      setAuthPendingPathname(pathname);
    } else if (authPendingPathname && authPendingPathname !== pathname) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- route changed before auth handoff completed
      setAuthPendingPathname(null);
    }
  }, [authPendingPathname, canRenderAuthenticatedTree, pathname]);

  // Malformed segment → hard 404. The auth hook above remains unconditional so
  // hook order is stable across route changes.
  if (!VAULT_NAME_RE.test(vault)) notFound();

  const vaultsQuery = useVaults({ enabled: canRenderAuthenticatedTree });
  // Render Reef only after AKB reports the canonical installation active and
  // the server has completed preservation-safe initialization.
  const isMember =
    canRenderAuthenticatedTree &&
    vaultsQuery.isSuccess &&
    vaultsQuery.data.some(
      (v) => v.name === vault && v.installation_status === "ready",
    );
  const requestedVault = vaultsQuery.data?.find(
    (entry) => entry.name === vault,
  );
  const canManageRequestedVault =
    requestedVault?.role === "owner" || requestedVault?.role === "admin";
  const showBlockedInstallationDiagnostics =
    canRenderAuthenticatedTree &&
    vaultsQuery.isSuccess &&
    canManageRequestedVault &&
    requestedVault.installation_status !== "ready" &&
    pathname === withVault(vault, "/settings/workspace");
  // One-way URL→Dexie sync: remember this vault as the per-browser default
  // after auth and membership are confirmed. Passing "" while the
  // session or membership is unknown makes the sync a no-op.
  useSyncActiveVaultFromUrl(isMember ? vault : "");

  if (authStatus === "unavailable" && !establishedAuthSession) {
    return (
      <AuthVerificationFallback mode="blocking" onRetry={retryAuthSession} />
    );
  }

  if (!canRenderAuthenticatedTree) {
    return (
      <WorkspaceAuthPendingSkeleton
        pathname={pathname}
        searchParams={searchParams.toString()}
      />
    );
  }

  // An established-session owner/admin may inspect the selected workspace's
  // setup diagnostics while it is unavailable. Keep this exception on one
  // route: ordinary feature pages and settings remain readiness-gated, and
  // the URL does not become the remembered active workspace.
  if (showBlockedInstallationDiagnostics) {
    return (
      <BlockedWorkspaceInstallationSettings
        appVersion={appVersion}
        vault={vault}
      />
    );
  }

  // Keep the access-denied surface outside the dashboard shell so its
  // dedicated account utility and recovery layout stay unchanged.
  if (canRenderAuthenticatedTree && vaultsQuery.isSuccess && !isMember) {
    return (
      <WorkspaceAccessDenied
        appVersion={appVersion}
        vault={vault}
        vaults={vaultsQuery.data}
        installationStatus={requestedVault?.installation_status}
        role={requestedVault?.role}
      />
    );
  }

  const shell = (
    <DashboardShell appVersion={appVersion}>
      <>
        {authStatus === "unavailable" ? (
          <AuthVerificationFallback mode="inline" onRetry={retryAuthSession} />
        ) : null}
        {children}
      </>
    </DashboardShell>
  );
  const entryIssueId = directIssueDetailId(pathname);
  const handoffPending =
    entryIssueId !== null && authPendingPathname === pathname;

  if (!handoffPending || !entryIssueId) return shell;

  return (
    <IssueDetailEntryHandoffProvider onReady={completeAuthHandoff}>
      {shell}
      <IssueDetailAuthPendingSkeleton
        issueId={entryIssueId}
        searchParams={searchParams.toString()}
        showWorkspaceSkeleton={false}
        overlayOnly
      />
    </IssueDetailEntryHandoffProvider>
  );
}
