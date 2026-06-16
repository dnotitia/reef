"use client";

import { hasActiveAkbSession } from "@/lib/akb/checkAkbSession";
import { getActiveVault } from "@/lib/storage/config";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * `root` — RootPage at `/`: redirect to `/issues` when fully onboarded.
 * `dashboard` — dashboard layout guard: render children when fully onboarded.
 * `onboarding` — `/onboarding` page: session check; vault is being picked here.
 */
export type AuthGateMode = "root" | "dashboard" | "onboarding";

/**
 * Shared client-side auth gate. Probe order:
 *   1. No active akb session → `/login`
 *   2. `onboarding` mode stops here — the user is on `/onboarding` to pick
 *      a vault, so the vault check would create a redirect loop.
 *   3. No active vault → `/onboarding`
 *   4. Otherwise: `root` redirects to `/issues`; `dashboard` passes through.
 *
 * GitHub PAT and LLM config are NOT gates — they are deferred capabilities
 * surfaced via inline CTAs on the issues / activity / AI surfaces.
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

        if (mode === "onboarding") return;

        const vault = await getActiveVault();
        if (controller.signal.aborted) return;

        if (!vault) {
          router.replace("/onboarding");
          return;
        }

        if (mode === "root") {
          router.replace("/issues");
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
