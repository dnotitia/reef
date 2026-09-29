"use client";

import { AccountMenu } from "@/features/auth/components/AccountMenu";
import { AuthVerificationFallback } from "@/features/auth/components/AuthVerificationFallback";
import {
  retryAuthSession,
  useAuthRedirect,
} from "@/features/auth/hooks/useAuthRedirect";
import { OnboardingPanel } from "@/features/onboarding/components/OnboardingPanel";
import { WorkspaceResumeShell } from "@/features/onboarding/components/WorkspaceResumeShell";
import { useWorkspaceAutoResume } from "@/features/onboarding/hooks/useWorkspaceAutoResume";
import { hasEstablishedAuthSession } from "@/lib/akb/authCoordinator";

interface OnboardingClientProps {
  appVersion: string;
  pageSubtitle: string;
}

/**
 * `OnboardingClient` is a thin Client Component shell: it runs the shared
 * auth gate in `onboarding` mode (session) and renders the panel.
 * The panel handles its own loading/error states for vault and repo data.
 */
export function OnboardingClient({
  appVersion,
  pageSubtitle,
}: OnboardingClientProps) {
  const authStatus = useAuthRedirect("onboarding");
  const establishedAuthSession = hasEstablishedAuthSession();
  const resume = useWorkspaceAutoResume({
    enabled: authStatus === "active",
  });

  if (authStatus === "unavailable" && !establishedAuthSession) {
    return (
      <AuthVerificationFallback mode="blocking" onRetry={retryAuthSession} />
    );
  }
  if (authStatus !== "active" && authStatus !== "unavailable") {
    return (
      <WorkspaceResumeShell status={resume.status} onRetry={resume.retry} />
    );
  }
  if (authStatus === "active" && resume.status !== "empty") {
    return (
      <WorkspaceResumeShell status={resume.status} onRetry={resume.retry} />
    );
  }

  return (
    <>
      {authStatus === "unavailable" ? (
        <AuthVerificationFallback mode="inline" onRetry={retryAuthSession} />
      ) : null}
      <main
        className="relative flex min-h-screen flex-col items-center justify-center gap-8 bg-surface-page p-8"
        data-testid="onboarding-page"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="font-display text-3xl font-semibold text-foreground">
            reef{/* i18n-exempt: brand name */}
          </h1>
          <p className="text-sm text-muted-foreground">{pageSubtitle}</p>
        </div>
        <div
          className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6"
          data-testid="onboarding-account-menu"
        >
          <AccountMenu appVersion={appVersion} placement="utility" />
        </div>
        <OnboardingPanel
          resumeState={authStatus === "active" ? resume : undefined}
        />
      </main>
    </>
  );
}
