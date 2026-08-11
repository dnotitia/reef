"use client";

import { AppShellSkeleton } from "@/components/AppShellSkeleton";
import { AccountMenu } from "@/features/auth/components/AccountMenu";
import { useAuthRedirect } from "@/features/auth/hooks/useAuthRedirect";
import { OnboardingPanel } from "@/features/onboarding/components/OnboardingPanel";

interface OnboardingClientProps {
  appVersion: string;
}

/**
 * `OnboardingClient` is a thin Client Component shell: it runs the shared
 * auth gate in `onboarding` mode (session) and renders the panel.
 * The panel handles its own loading/error states for vault and repo data.
 */
export function OnboardingClient({ appVersion }: OnboardingClientProps) {
  const authStatus = useAuthRedirect("onboarding");
  if (authStatus !== "active") return <AppShellSkeleton />;
  return (
    <>
      <div
        className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6"
        data-testid="onboarding-account-menu"
      >
        <AccountMenu appVersion={appVersion} placement="utility" />
      </div>
      <OnboardingPanel />
    </>
  );
}
