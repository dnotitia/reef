import { DashboardShell } from "@/features/ui/components/DashboardShell";
import { OnboardingGuard } from "@/features/ui/components/OnboardingGuard";
// Read app version at build time from the root package.json.
// This is a Server Component so the import runs at build time on the server —
// safe and zero client-bundle cost.
import pkg from "../../../../../package.json";

/**
 * DashboardLayout — wraps all (dashboard) routes with the DashboardShell and
 * an OnboardingGuard that redirects to /onboarding if the user hasn't
 * completed the setup wizard.
 */
export default function DashboardLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <OnboardingGuard>
      <DashboardShell appVersion={pkg.version}>
        {children}
        {modal}
      </DashboardShell>
    </OnboardingGuard>
  );
}
