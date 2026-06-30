"use client";

import { ActivityScanningSection } from "@/features/settings/components/ActivityScanningSection";
import { AuthoringLanguageSection } from "@/features/settings/components/AuthoringLanguageSection";
import { DangerZoneSection } from "@/features/settings/components/DangerZoneSection";
import { ProjectSection } from "@/features/settings/components/ProjectSection";
import { RepoPickerSection } from "@/features/settings/components/RepoPickerSection";
import { ResolvedAutoHideSection } from "@/features/settings/components/ResolvedAutoHideSection";
import { SettingsGroup } from "@/features/settings/components/SettingsGroup";
import { TemplatesSection } from "@/features/settings/components/TemplatesSection";
import { WorkspaceSkillSection } from "@/features/settings/components/WorkspaceSkillSection";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useWorkspaceAccess } from "@/features/settings/hooks/useWorkspaceAccess";
import { useTranslations } from "next-intl";

/**
 * Workspace › General (REEF-183) — the team-shared settings that the Active
 * Workspace selector (mounted in the workspace layout above) scopes. This is the
 * former "Workspace settings" group, moved verbatim into its own tab route.
 */
export default function WorkspaceGeneralPage() {
  const t = useTranslations("settings.routes");
  // Workspace-common settings are admin-managed (REEF-020); non-admin viewers
  // see them read. The active vault drives which workspace's role applies.
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const { canEditWorkspace, isResolving } = useWorkspaceAccess(vault);
  // Omit the badge until BOTH the active vault and the vault-role query have
  // resolved. useActiveVault returns vault="" on the first client render (to
  // match SSR) while it hydrates from Dexie; with a persisted vault-role cache
  // the role query can already have data at that point, so computing access
  // from the still-empty vault would render a "View just" badge the server did
  // not — a hydration mismatch and a wrong-access flash for members who can
  // actually edit (REEF-174).
  const workspaceAccess =
    vaultLoading || isResolving
      ? undefined
      : canEditWorkspace
        ? "editable"
        : "view-only";

  // The workspace these shared settings belong to, echoed in the group header
  // so the values read as scoped to the active selection — omitted while the
  // vault is still hydrating or unset (REEF-174).
  const scopeName = vaultLoading || !vault ? undefined : vault;

  return (
    <SettingsGroup
      title={t("general.title")}
      description={t("general.description")}
      access={workspaceAccess}
      scopeName={scopeName}
      testId="settings-group-workspace"
    >
      {/* Monitored Repositories — team-shared grounding repos */}
      <section className="flex flex-col gap-3">
        <h3 className="font-display text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("general.monitoredRepositories")}
        </h3>
        <RepoPickerSection canEdit={canEditWorkspace} />
      </section>

      {/* Activity Scanning — AI scan kill switch over the monitored repos */}
      <section className="flex flex-col gap-3">
        <h3 className="font-display text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("general.activityScanning")}
        </h3>
        <ActivityScanningSection canEdit={canEditWorkspace} />
      </section>

      {/* Project — project_prefix for issue IDs */}
      <section className="flex flex-col gap-3">
        <h3 className="font-display text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("general.project")}
        </h3>
        <ProjectSection canEdit={canEditWorkspace} />
      </section>

      {/* Authoring Language — default language for AI-generated content */}
      <section className="flex flex-col gap-3">
        <h3 className="font-display text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("general.authoringLanguage")}
        </h3>
        <AuthoringLanguageSection canEdit={canEditWorkspace} />
      </section>

      {/* Completed Issues - workspace auto-hide windows for resolved issues */}
      <section className="flex flex-col gap-3">
        <h3 className="font-display text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("general.completedIssues")}
        </h3>
        <ResolvedAutoHideSection canEdit={canEditWorkspace} />
      </section>

      {/* Templates — issue templates shared across the workspace */}
      <section className="flex flex-col gap-3">
        <h3 className="font-display text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("general.templates")}
        </h3>
        <TemplatesSection canEdit={canEditWorkspace} />
      </section>

      {/* Workspace AI Instructions — vault-skill version + explicit update */}
      <section className="flex flex-col gap-3">
        <h3 className="font-display text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("general.workspaceAiInstructions")}
        </h3>
        <WorkspaceSkillSection />
      </section>

      {/* Danger zone — owner-scoped workspace lifecycle (delete / detach). Renders
          itself null for non-owners, so it sits at the foot of the group. */}
      <DangerZoneSection vault={vault} />
    </SettingsGroup>
  );
}
