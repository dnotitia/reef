"use client";

import { AppShellSkeleton } from "@/components/AppShellSkeleton";
import { useAuthRedirect } from "@/features/auth/hooks/useAuthRedirect";

/**
 * Root route — gates on akb session and active workspace, then sends the
 * user to `/login`, `/onboarding`, or `/issues`. See `useAuthRedirect` for
 * the full decision tree. While the redirect resolves, paint the board app
 * shell instead of a bare "Loading…" line (REEF-097 AC2).
 */
export default function RootPage() {
  useAuthRedirect("root");
  return <AppShellSkeleton />;
}
