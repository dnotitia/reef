"use client";

import {
  type PendingAkbAccountErrorSnapshot,
  snapshotPendingAkbAccountError,
  subscribeAkbAccountDenied,
} from "@/lib/akb/accountDenialClient";
import { getAkbSessionStatus } from "@/lib/akb/checkAkbSession";
import {
  ensureAuthSession,
  hasEstablishedAuthSession,
  subscribeAuthCoordinator,
} from "@/lib/akb/authCoordinator";
import {
  buildPathWithParams,
  normalizeSafeRedirect,
} from "@/lib/akb/safeRedirect";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * `root` — RootPage at `/`: redirect to the Dexie default workspace's
 *   `/workspace/{vault}/issues` when fully onboarded (REEF-315).
 * `workspace` — workspace layout guard: session-scoped gate. The vault now lives
 *   in the URL, so membership (not a Dexie pointer) is validated downstream by
 *   `WorkspaceGuard`; an empty Dexie pointer should not bounce a member who
 *   followed a shared `/workspace/{vault}/...` link to `/onboarding`.
 * `onboarding` — `/onboarding` page: session check; vault is being picked here.
 */
export type AuthGateMode = "root" | "workspace" | "onboarding";
export type AuthGateStatus = "checking" | "active" | "inactive";

/**
 * Shared client-side auth gate. A single coordinator owns probe freshness,
 * timeout, focus/visibility revalidation, and auth-change invalidation. This
 * hook owns only route-specific login navigation and the protected subtree's
 * render status.
 */
export function useAuthRedirect(mode: AuthGateMode): AuthGateStatus {
  const router = useRouter();
  const replace = router.replace;
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const [status, setStatus] = useState<AuthGateStatus>(() =>
    hasEstablishedAuthSession() ? "active" : "checking",
  );

  useEffect(() => {
    let mounted = true;
    let redirectCommitted = false;

    const redirectToLogin = (
      accountError?:
        | "membership_required"
        | "account_suspended"
        | "identity_conflict",
      pending?: PendingAkbAccountErrorSnapshot,
    ) => {
      if (!mounted || redirectCommitted) return;
      const pendingSnapshot = pending ?? snapshotPendingAkbAccountError();
      const effectiveAccountError = accountError ?? pendingSnapshot?.code;
      redirectCommitted = true;
      setStatus("inactive");
      replace(
        effectiveAccountError
          ? buildPathWithParams("/login", {
              sso_error: effectiveAccountError,
              ...(pendingSnapshot?.code === effectiveAccountError
                ? { sso_error_token: pendingSnapshot.token }
                : {}),
            })
          : mode === "workspace"
            ? buildPathWithParams("/login", {
                redirect: normalizeSafeRedirect(pathnameRef.current),
              })
            : "/login",
      );
    };

    const unsubscribeCoordinator = subscribeAuthCoordinator((next) => {
      if (!mounted) return;
      if (next.status === "inactive") {
        redirectToLogin(
          next.accountError,
          next.accountError && next.accountErrorToken
            ? {
                code: next.accountError,
                token: next.accountErrorToken,
              }
            : undefined,
        );
        return;
      }
      setStatus(next.status);
    }, getAkbSessionStatus);
    const unsubscribeAccountDenial = subscribeAkbAccountDenied(redirectToLogin);

    ensureAuthSession(getAkbSessionStatus);

    return () => {
      mounted = false;
      unsubscribeCoordinator();
      unsubscribeAccountDenial();
    };
  }, [mode, replace]);

  return status;
}
