"use client";

import {
  type PendingAkbAccountErrorSnapshot,
  snapshotPendingAkbAccountError,
  subscribeAkbAccountDenied,
} from "@/lib/akb/accountDenialClient";
import { getAkbSessionStatus } from "@/lib/akb/checkAkbSession";
import { buildPathWithParams } from "@/lib/akb/safeRedirect";
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
 * Shared client-side auth gate. Probe order:
 *   1. No active akb session → `/login`
 *   2. All modes stop here. Root and onboarding workspace selection is owned by
 *      the shared workspace auto-resume policy, while workspace membership is
 *      validated downstream by `WorkspaceGuard`.
 *
 * GitHub App and LLM config are NOT login gates - they are deployment
 * capabilities surfaced on the GitHub / activity / AI surfaces.
 */
export function useAuthRedirect(mode: AuthGateMode): AuthGateStatus {
  const router = useRouter();
  const pathname = usePathname();
  const [authState, setAuthState] = useState<{
    mode: AuthGateMode;
    status: AuthGateStatus;
  }>({ mode, status: "checking" });
  const status = authState.mode === mode ? authState.status : "checking";

  useEffect(() => {
    const controller = new AbortController();
    let redirectCommitted = false;

    const redirectToLogin = (
      accountError?:
        | "membership_required"
        | "account_suspended"
        | "identity_conflict",
      pending?: PendingAkbAccountErrorSnapshot,
    ) => {
      if (redirectCommitted || controller.signal.aborted) return;
      const pendingSnapshot = pending ?? snapshotPendingAkbAccountError();
      const effectiveAccountError = accountError ?? pendingSnapshot?.code;
      redirectCommitted = true;
      setAuthState({ mode, status: "inactive" });
      router.replace(
        effectiveAccountError
          ? buildPathWithParams("/login", {
              sso_error: effectiveAccountError,
              ...(pendingSnapshot?.code === effectiveAccountError
                ? { sso_error_token: pendingSnapshot.token }
                : {}),
            })
          : mode === "workspace"
            ? buildPathWithParams("/login", { redirect: pathname })
            : "/login",
      );
    };
    const unsubscribe = subscribeAkbAccountDenied(redirectToLogin);

    async function run() {
      try {
        const session = await getAkbSessionStatus(controller.signal);
        if (controller.signal.aborted) return;

        if (!session.active) {
          redirectToLogin(
            session.accountError,
            session.accountError && session.accountErrorToken
              ? {
                  code: session.accountError,
                  token: session.accountErrorToken,
                }
              : undefined,
          );
          return;
        }

        if (redirectCommitted) return;

        setAuthState({ mode, status: "active" });
      } catch {
        if (controller.signal.aborted) return;
        redirectToLogin();
      }
    }

    void run();
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [router, mode, pathname]);

  return status;
}
