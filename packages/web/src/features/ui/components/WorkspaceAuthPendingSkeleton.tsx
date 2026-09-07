"use client";

import { AppShellSkeleton } from "@/components/AppShellSkeleton";
import {
  SEGMENTED_CONTROL_ITEM,
  SEGMENTED_CONTROL_ITEM_ACTIVE,
  SEGMENTED_CONTROL_ITEM_INACTIVE,
  SEGMENTED_CONTROL_TRACK,
} from "@/components/segmentedControl";
import { IssueDetailSkeleton } from "@/features/issues/components/detail/IssueDetailSkeleton";
import { IssuesWorkspaceSkeleton } from "@/features/issues/components/filters/IssuesWorkspaceSkeleton";
import { MyWorkPageSkeleton } from "@/features/my-work/components/MyWorkPageSkeleton";
import { PlanningPageSkeleton } from "@/features/planning/components/PlanningPageSkeleton";
import { SprintDetailPageSkeleton } from "@/features/planning/components/SprintDetailPageSkeleton";
import {
  ReportsSkeleton,
  PageShell,
} from "@/features/reports/components/ReportLayout";
import {
  DeploymentSettingsLoading,
  MembersSettingsLoading,
  PreferencesSettingsLoading,
  WorkspaceSettingsLoading,
} from "@/features/settings/components/SettingsLoadingSkeleton";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

function IssueDetailAuthPendingSkeleton() {
  const nav = useTranslations("nav");
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title={nav("issues")} />
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <IssueDetailSkeleton />
      </div>
    </div>
  );
}

function StaticSettingsTabs({
  active,
}: {
  active: "workspace" | "preferences" | "deployment";
}) {
  const t = useTranslations("settings.misc");
  const tabs = [
    ["workspace", t("tabWorkspace")],
    ["preferences", t("tabPreferences")],
    ["deployment", t("tabDeployment")],
  ] as const;
  return (
    <nav
      aria-label={t("settingsSections")}
      data-testid="auth-pending-settings-tabs"
      className={cn(
        SEGMENTED_CONTROL_TRACK,
        "!grid w-full max-w-full grid-cols-3 self-start",
      )}
    >
      {tabs.map(([id, label]) => (
        <span
          key={id}
          className={cn(
            SEGMENTED_CONTROL_ITEM,
            "min-w-0 justify-center text-center",
            id === active
              ? SEGMENTED_CONTROL_ITEM_ACTIVE
              : SEGMENTED_CONTROL_ITEM_INACTIVE,
          )}
        >
          {label}
        </span>
      ))}
    </nav>
  );
}

function SettingsAuthPendingSkeleton({ pathname }: { pathname: string }) {
  const nav = useTranslations("nav");
  const isPreferences = pathname.endsWith("/settings/preferences");
  const isDeployment = pathname.endsWith("/settings/deployment");
  const active = isPreferences
    ? "preferences"
    : isDeployment
      ? "deployment"
      : "workspace";
  const content = isPreferences ? (
    <PreferencesSettingsLoading />
  ) : isDeployment ? (
    <DeploymentSettingsLoading />
  ) : pathname.endsWith("/settings/workspace/members") ? (
    <MembersSettingsLoading />
  ) : (
    <WorkspaceSettingsLoading />
  );
  return (
    <div className="flex h-full min-w-0 flex-col">
      <PageHeader title={nav("settings")} />
      <PageBody width="narrow" className="flex flex-col gap-6">
        <StaticSettingsTabs active={active} />
        {content}
      </PageBody>
    </div>
  );
}

function AuthPendingContent({ pathname }: { pathname: string }) {
  if (/\/issues\/[^/]+$/.test(pathname)) {
    return <IssueDetailAuthPendingSkeleton />;
  }
  if (pathname.includes("/settings")) {
    return <SettingsAuthPendingSkeleton pathname={pathname} />;
  }
  if (/\/planning\/sprints\/[^/]+$/.test(pathname)) {
    return <SprintDetailPageSkeleton />;
  }
  if (pathname.endsWith("/planning")) {
    return <PlanningPageSkeleton />;
  }
  if (pathname.endsWith("/my-work")) {
    return <MyWorkPageSkeleton />;
  }
  if (pathname.endsWith("/reports")) {
    return (
      <PageShell>
        <ReportsSkeleton />
      </PageShell>
    );
  }
  if (pathname.endsWith("/issues")) {
    return <IssuesWorkspaceSkeleton />;
  }
  return null;
}

function hasAuthPendingContent(pathname: string): boolean {
  return (
    /\/issues\/[^/]+$/.test(pathname) ||
    pathname.includes("/settings") ||
    /\/planning\/sprints\/[^/]+$/.test(pathname) ||
    pathname.endsWith("/planning") ||
    pathname.endsWith("/my-work") ||
    pathname.endsWith("/reports") ||
    pathname.endsWith("/issues")
  );
}

/**
 * Auth-pending shell for a vault URL. The protected children stay unmounted;
 * only the pathname selects an existing static loading surface so a hard
 * navigation keeps its destination chrome visible while `/auth/me` resolves.
 */
export function WorkspaceAuthPendingSkeleton({
  pathname,
}: {
  pathname: string | null;
}) {
  const normalizedPathname = pathname ?? "";
  const hasContent = hasAuthPendingContent(normalizedPathname);
  return (
    <AppShellSkeleton
      content={
        hasContent ? (
          <AuthPendingContent pathname={normalizedPathname} />
        ) : undefined
      }
      announce={!hasContent}
    />
  );
}
