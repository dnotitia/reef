"use client";

import { AppShellSkeleton } from "@/components/AppShellSkeleton";
import { useAuthRedirect } from "@/features/auth/hooks/useAuthRedirect";
import { WorkspaceResumeStatus } from "@/features/onboarding/components/WorkspaceResumeStatus";
import { useWorkspaceAutoResume } from "@/features/onboarding/hooks/useWorkspaceAutoResume";

/**
 * `/workspace` is an alias for the global root redirect contract. Only this
 * unscoped route may consult the remembered Dexie workspace default; explicit
 * `/workspace/[vault]` routes keep their URL vault as the source of truth.
 */
export default function WorkspaceRootPage() {
  const authStatus = useAuthRedirect("root");
  const resume = useWorkspaceAutoResume({
    enabled: authStatus === "active",
    redirectWhenEmpty: true,
  });

  if (authStatus !== "active" || resume.status === "disabled") {
    return <AppShellSkeleton />;
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <WorkspaceResumeStatus status={resume.status} onRetry={resume.retry} />
    </main>
  );
}
