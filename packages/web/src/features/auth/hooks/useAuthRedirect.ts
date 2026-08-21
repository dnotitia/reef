"use client";

import {
  type PendingAkbAccountErrorSnapshot,
  snapshotPendingAkbAccountError,
  subscribeAkbAccountDenied,
} from "@/lib/akb/accountDenialClient";
import { getAkbSessionStatus } from "@/lib/akb/checkAkbSession";
import {
  requestAuthProbe,
  subscribeAuthCoordinator,
} from "@/lib/akb/authCoordinator";
import {
  buildPathWithParams,
  normalizeSafeRedirect,
} from "@/lib/akb/safeRedirect";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
  const routeKey = `${mode}:${pathname}`;
  const [authState, setAuthState] = useState<{
    routeKey: string;
    status: AuthGateStatus;
  }>({ routeKey, status: "checking" });

  // A soft navigation can preserve this hook instance for one render while
  // Next prepares the destination. The key mismatch deliberately keeps the
  // neutral shell mounted until the newest probe concludes.
  const status =
    authState.routeKey === routeKey ? authState.status : "checking";

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
      setAuthState({ routeKey, status: "inactive" });
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
                redirect: normalizeSafeRedirect(pathname),
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
      setAuthState({ routeKey, status: next.status });
    }, getAkbSessionStatus);
    const unsubscribeAccountDenial = subscribeAkbAccountDenied(redirectToLogin);

    requestAuthProbe(getAkbSessionStatus);

    return () => {
      mounted = false;
      unsubscribeCoordinator();
      unsubscribeAccountDenial();
    };
  }, [mode, pathname, replace, routeKey]);

  return status;
}
