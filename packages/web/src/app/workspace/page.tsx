"use client";

import { AppShellSkeleton } from "@/components/AppShellSkeleton";
import { AuthVerificationFallback } from "@/features/auth/components/AuthVerificationFallback";
import {
  retryAuthSession,
  useAuthRedirect,
} from "@/features/auth/hooks/useAuthRedirect";
import { WorkspaceResumeShell } from "@/features/onboarding/components/WorkspaceResumeShell";
import { useWorkspaceAutoResume } from "@/features/onboarding/hooks/useWorkspaceAutoResume";

/**
 * `/workspace` is an alias for the global root redirect contract. The unscoped
 * route consults the remembered Dexie workspace default; explicit
 * `/workspace/[vault]` routes derive the workspace from their URL vault.
 */
export default function WorkspaceRootPage() {
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
  return <WorkspaceResumeShell status={resume.status} onRetry={resume.retry} />;
}
