"use client";

import {
  type PendingAkbAccountErrorSnapshot,
  subscribeAkbAccountDenied,
} from "@/lib/akb/accountDenialClient";
import { getAkbSessionStatus } from "@/lib/akb/checkAkbSession";
import { buildPathWithParams } from "@/lib/akb/safeRedirect";
import { getActiveVault } from "@/lib/storage/config";
import { withVault } from "@/lib/workspaceHref";
import { useRouter } from "next/navigation";
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
 *   2. `onboarding` and `workspace` modes stop here — onboarding is where the
 *      vault is picked, and the workspace tree carries the vault in the URL, so
 *      a Dexie-pointer check would either loop or wrongly bounce a shared link.
 *   3. No active vault → `/onboarding`
 *   4. `root` redirects to the default workspace's board.
 *
 * GitHub App and LLM config are NOT login gates - they are deployment
 * capabilities surfaced on the GitHub / activity / AI surfaces.
 */
export function useAuthRedirect(mode: AuthGateMode): AuthGateStatus {
  const router = useRouter();
  const [status, setStatus] = useState<AuthGateStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();
    let redirectCommitted = false;
    setStatus("checking");

    const redirectToLogin = (
      accountError?:
        | "membership_required"
        | "account_suspended"
        | "identity_conflict",
      pending?: PendingAkbAccountErrorSnapshot,
    ) => {
      if (redirectCommitted || controller.signal.aborted) return;
      redirectCommitted = true;
      setStatus("inactive");
      router.replace(
        accountError
          ? buildPathWithParams("/login", {
              sso_error: accountError,
              ...(pending?.code === accountError
                ? { sso_error_token: pending.token }
                : {}),
            })
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

        setStatus("active");

        if (mode === "onboarding" || mode === "workspace") return;

        const vault = await getActiveVault();
        if (controller.signal.aborted) return;

        if (!vault) {
          router.replace("/onboarding");
          return;
        }

        if (mode === "root") {
          router.replace(withVault(vault, "/issues"));
        }
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
  }, [router, mode]);

  return status;
}
