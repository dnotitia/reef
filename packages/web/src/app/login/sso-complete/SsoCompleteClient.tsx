"use client";

import { ReefMark } from "@/components/ui/reef-mark";
import { CURRENT_USER_QUERY_KEY } from "@/features/auth/hooks/useCurrentUser";
import { reconcileAkbAccount } from "@/lib/akb/accountReconcile";
import { normalizeSafeRedirect } from "@/lib/akb/safeRedirect";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export function SsoCompleteClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const nextPath = normalizeSafeRedirect(searchParams.get("next"));

  useEffect(() => {
    let cancelled = false;

    async function finishSignIn() {
      try {
        const res = await fetch("/api/auth/akb/me", {
          credentials: "same-origin",
        });
        if (!res.ok) {
          throw new Error("SSO completion profile check failed.");
        }
        const profile: unknown = await res.json();
        const userId = extractAkbUserId(profile);
        if (!userId) {
          throw new Error("SSO completion profile is missing a user id.");
        }
        await reconcileAkbAccount(userId);
        await queryClient.invalidateQueries({
          queryKey: CURRENT_USER_QUERY_KEY,
        });
        if (cancelled) return;
        router.replace(nextPath);
        router.refresh();
      } catch {
        if (cancelled) return;
        router.replace("/login?sso_error=completion_failed");
        router.refresh();
      }
    }

    void finishSignIn();

    return () => {
      cancelled = true;
    };
  }, [nextPath, queryClient, router]);

  return <SsoCompletionStatus />;
}

export function SsoCompletionStatus() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background p-8 text-center">
      <ReefMark className="size-11" decorative />
      <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      <p className="text-sm text-muted-foreground">Finishing sign-in...</p>
    </main>
  );
}

function extractAkbUserId(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const record = profile as Record<string, unknown>;
  for (const key of ["user_id", "id", "username", "sub"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}
