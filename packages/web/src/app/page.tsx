"use client";

import { AppShellSkeleton } from "@/components/AppShellSkeleton";
import { AuthVerificationFallback } from "@/features/auth/components/AuthVerificationFallback";
import {
  retryAuthSession,
  useAuthRedirect,
} from "@/features/auth/hooks/useAuthRedirect";
import { WorkspaceResumeStatus } from "@/features/onboarding/components/WorkspaceResumeStatus";
import { useWorkspaceAutoResume } from "@/features/onboarding/hooks/useWorkspaceAutoResume";

/**
 * Root route — gates on akb session and active workspace, then sends the
 * user to `/login`, `/onboarding`, or `/workspace/{vault}/issues`. See
 * `useAuthRedirect` for the full decision tree. While the redirect resolves,
 * paint the board app shell instead of a bare "Loading…" line (REEF-097 AC2).
 */
export default function RootPage() {
  const authStatus = useAuthRedirect("root");
  const resume = useWorkspaceAutoResume({
    enabled: authStatus === "active",
    redirectWhenEmpty: true,
  });

  if (authStatus === "unavailable") {
    return (
      <AuthVerificationFallback mode="blocking" onRetry={retryAuthSession} />
    );
  }

  if (authStatus !== "active" || resume.status === "disabled") {
    return <AppShellSkeleton />;
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <WorkspaceResumeStatus status={resume.status} onRetry={resume.retry} />
    </main>
  );
}
