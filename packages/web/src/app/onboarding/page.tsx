/**
 * /onboarding — Single-screen project onboarding.
 *
 * The page is intentionally a thin Server Component shell so it can render
 * the heading SSR-first; the actual create-workspace panel is a Client
 * Component owning all client-side state.
 *
 * No user data is accessed server-side.
 */
import { useTranslations } from "next-intl";
import { OnboardingClient } from "./OnboardingClient";
import pkg from "../../../../../package.json";

export default function OnboardingPage() {
  const t = useTranslations("onboarding");
  return (
    <OnboardingClient
      appVersion={pkg.version}
      pageSubtitle={t("pageSubtitle")}
    />
  );
}
