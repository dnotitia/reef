"use client";

import { hasActiveAkbSession } from "@/lib/akb/checkAkbSession";
import { getActiveVault } from "@/lib/storage/config";
import { withVault } from "@/lib/workspaceHref";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * `root` — RootPage at `/`: redirect to the Dexie default workspace's
 *   `/workspace/{vault}/issues` when fully onboarded (REEF-315).
 * `workspace` — workspace layout guard: session-only gate. The vault now lives
 *   in the URL, so membership (not a Dexie pointer) is validated downstream by
 *   `WorkspaceGuard`; an empty Dexie pointer must NOT bounce a member who
 *   followed a shared `/workspace/{vault}/...` link to `/onboarding`.
 * `onboarding` — `/onboarding` page: session check; vault is being picked here.
 */
export type AuthGateMode = "root" | "workspace" | "onboarding";

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
export function useAuthRedirect(mode: AuthGateMode): void {
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    async function run() {
      try {
        const sessionActive = await hasActiveAkbSession(controller.signal);
        if (controller.signal.aborted) return;

        if (!sessionActive) {
          router.replace("/login");
          return;
        }

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
        router.replace("/login");
      }
    }

    void run();
    return () => controller.abort();
  }, [router, mode]);
}
