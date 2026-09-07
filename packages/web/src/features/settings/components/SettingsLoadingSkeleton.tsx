"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { SettingsGroup } from "./SettingsGroup";

function LoadingSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="type-settings-section text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function StaticSubNav({
  ariaLabel,
  labels,
}: {
  ariaLabel: string;
  labels: readonly string[];
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="flex w-full max-w-full flex-wrap items-center gap-4 border-b border-border-subtle"
    >
      {labels.map((label, index) => (
        <span
          key={label}
          className={cn(
            "-mb-px min-w-0 border-b-2 px-0.5 py-2 type-navigation font-medium",
            index === 0
              ? "border-brand-focus text-foreground"
              : "border-transparent text-muted-foreground",
          )}
        >
          {label}
        </span>
      ))}
    </nav>
  );
}

function ActiveWorkspaceLoading() {
  const t = useTranslations("settings.config.activeWorkspace");
  return (
    <section
      data-testid="active-workspace-loading"
      aria-labelledby="active-workspace-loading-heading"
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-subtle/50 px-4 py-4"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="active-workspace-loading-heading"
          className="type-settings-group text-foreground"
        >
          {t("heading")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      <div aria-hidden="true" className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 min-w-[12rem] flex-1" />
        <Skeleton className="h-8 w-32" />
      </div>
    </section>
  );
}

/** Loading shape for Settings → Workspace → General. */
export function WorkspaceSettingsLoading() {
  const common = useTranslations("common");
  const routes = useTranslations("settings.routes");
  const general = useTranslations("settings.routes.general");
  const misc = useTranslations("settings.misc");
  return (
    <div
      data-testid="settings-workspace-skeleton"
      className="flex min-w-0 flex-col gap-4"
    >
      <output className="sr-only">{common("loading")}</output>
      <ActiveWorkspaceLoading />
      <StaticSubNav
        ariaLabel={misc("workspaceSections")}
        labels={[misc("subtabGeneral"), misc("subtabMembers")]}
      />
      <SettingsGroup
        title={routes("general.title")}
        description={routes("general.description")}
        testId="settings-workspace-loading-group"
      >
        <LoadingSection title={general("monitoredRepositories")}>
          <Skeleton aria-hidden="true" className="h-10 w-full" />
        </LoadingSection>
        <LoadingSection title={general("project")}>
          <Skeleton aria-hidden="true" className="h-8 w-40" />
        </LoadingSection>
        <LoadingSection title={general("authoringLanguage")}>
          <Skeleton aria-hidden="true" className="h-8 w-64" />
        </LoadingSection>
        <LoadingSection title={general("completedIssues")}>
          <Skeleton aria-hidden="true" className="h-16 w-full" />
        </LoadingSection>
        <LoadingSection title={general("templates")}>
          <Skeleton aria-hidden="true" className="h-24 w-full" />
        </LoadingSection>
        <LoadingSection title={general("workspaceAiInstructions")}>
          <Skeleton aria-hidden="true" className="h-16 w-full" />
        </LoadingSection>
      </SettingsGroup>
    </div>
  );
}

/** Loading shape for Settings → Preferences. */
export function PreferencesSettingsLoading() {
  const common = useTranslations("common");
  const routes = useTranslations("settings.routes");
  const preferences = useTranslations("settings.preferences");
  return (
    <div
      data-testid="settings-preferences-skeleton"
      className="flex min-w-0 flex-col"
    >
      <output className="sr-only">{common("loading")}</output>
      <SettingsGroup
        title={routes("preferences.title")}
        description={routes("preferences.description")}
        testId="settings-preferences-loading-group"
      >
        <LoadingSection title={preferences("appearance.heading")}>
          <p className="type-caption text-muted-foreground">
            {preferences("appearance.description")}
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-2">
            {["theme-one", "theme-two", "theme-three"].map((key) => (
              <Skeleton aria-hidden="true" key={key} className="h-16 w-full" />
            ))}
          </div>
        </LoadingSection>
        <LoadingSection title={preferences("language.heading")}>
          <p className="type-caption text-muted-foreground">
            {preferences("language.description")}
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-2">
            {["locale-one", "locale-two"].map((key) => (
              <Skeleton aria-hidden="true" key={key} className="h-12 w-full" />
            ))}
          </div>
        </LoadingSection>
      </SettingsGroup>
    </div>
  );
}

/** Loading shape for Settings → Deployment. */
export function DeploymentSettingsLoading() {
  const common = useTranslations("common");
  const routes = useTranslations("settings.routes");
  return (
    <div
      data-testid="settings-deployment-skeleton"
      className="flex min-w-0 flex-col"
    >
      <output className="sr-only">{common("loading")}</output>
      <SettingsGroup
        title={routes("deployment.title")}
        description={routes("deployment.description")}
        testId="settings-deployment-loading-group"
      >
        <LoadingSection title={routes("deployment.aiConfiguration")}>
          <Skeleton aria-hidden="true" className="h-16 w-full" />
        </LoadingSection>
      </SettingsGroup>
    </div>
  );
}

/** Loading shape for Settings → Workspace → Members. */
export function MembersSettingsLoading() {
  const common = useTranslations("common");
  const routes = useTranslations("settings.routes");
  const misc = useTranslations("settings.misc");
  return (
    <div
      data-testid="settings-members-skeleton"
      className="flex min-w-0 flex-col gap-4"
    >
      <output className="sr-only">{common("loading")}</output>
      <ActiveWorkspaceLoading />
      <StaticSubNav
        ariaLabel={misc("workspaceSections")}
        labels={[misc("subtabGeneral"), misc("subtabMembers")]}
      />
      <SettingsGroup
        title={routes("members.title")}
        description={routes("members.description")}
        testId="settings-members-loading-group"
      >
        <div className="flex flex-col gap-2">
          {["member-one", "member-two", "member-three"].map((key) => (
            <Skeleton aria-hidden="true" key={key} className="h-12 w-full" />
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
}
