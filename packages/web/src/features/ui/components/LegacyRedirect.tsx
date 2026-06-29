"use client";

import { AppShellSkeleton } from "@/components/AppShellSkeleton";
import { getActiveVault } from "@/lib/storage/config";
import { withVault } from "@/lib/workspaceHref";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * Backward-compat client redirect for the pre-REEF-315 flat URLs (`/issues`,
 * `/planning`, `/settings/...`, …). The active vault used to be a browser-only
 * Dexie pointer, so the server cannot know which workspace an old bookmark or
 * shared link meant — only the client can. This shim reads that "last viewed"
 * default and forwards to the vault-scoped equivalent
 * (`/workspace/{vault}/<path>`), preserving the query string, or sends the user
 * to `/onboarding` when no default exists yet (AC4). It is a transitional
 * surface (one or two releases); once old links age out, the `(legacy)` route
 * group can be deleted.
 */
export function LegacyRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const vault = await getActiveVault();
      if (cancelled) return;
      const queryString = searchParams.toString();
      const suffix = queryString ? `${pathname}?${queryString}` : pathname;
      router.replace(vault ? withVault(vault, suffix) : "/onboarding");
    })();
    return () => {
      cancelled = true;
    };
  }, [router, pathname, searchParams]);

  return <AppShellSkeleton />;
}
