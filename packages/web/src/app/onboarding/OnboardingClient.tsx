"use client";

import { useAuthRedirect } from "@/features/auth/hooks/useAuthRedirect";
import { OnboardingPanel } from "@/features/onboarding/components/OnboardingPanel";

/**
 * `OnboardingClient` is a thin Client Component shell: it runs the shared
 * auth gate in `onboarding` mode (session) and renders the panel.
 * The panel handles its own loading/error states for vault and repo data.
 */
export function OnboardingClient() {
  useAuthRedirect("onboarding");
  return <OnboardingPanel />;
}
