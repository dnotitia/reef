/**
 * /onboarding — Single-screen project onboarding.
 *
 * The page is intentionally a thin Server Component shell so it can render
 * the heading SSR-first; the actual panel (new workspace form, existing
 * workspace picker, and optional tiles) is a Client Component owning all
 * client-side state.
 *
 * No user data is accessed server-side.
 */
import { OnboardingClient } from "./OnboardingClient";

export default function OnboardingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="font-display text-3xl font-semibold text-foreground">
          reef
        </h1>
        <p className="text-sm text-muted-foreground">
          Create a project workspace or pick an existing one.
        </p>
      </div>
      <OnboardingClient />
    </main>
  );
}
