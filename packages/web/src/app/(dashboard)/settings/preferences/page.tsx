"use client";

import { PreferencesSection } from "@/features/preferences/components/PreferencesSection";
import { SettingsGroup } from "@/features/settings/components/SettingsGroup";

/**
 * Settings > Preferences (REEF-183) - browser-local, per-person settings.
 * None of this is workspace-scoped, so this tab deliberately does NOT mount the
 * Active Workspace selector (AC2).
 *
 * Auth model post-akb pivot:
 *  - The akb workspace session lives in an httpOnly cookie (`__reef_session`).
 *    Signing out of the workspace is a separate action owned by the sidebar
 *    account menu (REEF-068); it is intentionally not part of this screen.
 *  - Monitored-repo GitHub access is deployment-managed through the server
 *    GitHub App; this screen no longer stores user credentials (REEF-244).
 */
export default function PreferencesPage() {
  return (
    <SettingsGroup
      title="Your preferences"
      description="Stored in this browser only - for you."
      testId="settings-group-personal"
    >
      {/* Appearance owns its own section heading + description, so it is
          rendered directly here - no wrapper heading, which would duplicate
          "Appearance" (REEF-151). */}
      <PreferencesSection />
    </SettingsGroup>
  );
}
