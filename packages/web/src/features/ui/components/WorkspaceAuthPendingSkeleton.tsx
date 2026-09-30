"use client";

import { AppShellSkeleton } from "@/components/AppShellSkeleton";
import { SIDEBAR_NAV_ITEMS } from "@/components/sidebarChrome";
import {
  SEGMENTED_CONTROL_ITEM,
  SEGMENTED_CONTROL_ITEM_ACTIVE,
  SEGMENTED_CONTROL_ITEM_INACTIVE,
  SEGMENTED_CONTROL_TRACK,
} from "@/components/segmentedControl";
import { IssueDetailAuthPendingSkeleton } from "@/features/issues/components/detail/IssueDetailAuthPendingSkeleton";
import { IssuesWorkspaceSkeleton } from "@/features/issues/components/filters/IssuesWorkspaceSkeleton";
import { NotificationInboxSkeleton } from "@/features/inbox/components/NotificationInbox";
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
import { useViewStore } from "@/features/ui/stores/useViewStore";
import { cn } from "@/lib/utils";
import { Building2, Server, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

function StaticSettingsTabs({
  active,
}: {
  active: "workspace" | "preferences" | "deployment";
}) {
  const t = useTranslations("settings.misc");
  const tabs = [
    ["workspace", t("tabWorkspace"), Building2],
    ["preferences", t("tabPreferences"), SlidersHorizontal],
    ["deployment", t("tabDeployment"), Server],
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
      {tabs.map(([id, label, Icon]) => (
        <span
          key={id}
          data-testid={`settings-tab-${id}`}
          className={cn(
            SEGMENTED_CONTROL_ITEM,
            "min-w-0 justify-center text-center",
            id === active
              ? SEGMENTED_CONTROL_ITEM_ACTIVE
              : SEGMENTED_CONTROL_ITEM_INACTIVE,
          )}
        >
          <Icon
            className="h-3.5 w-3.5 shrink-0 max-[480px]:hidden"
            aria-hidden="true"
          />
          {label}
        </span>
      ))}
    </nav>
  );
}

function SettingsAuthPendingSkeleton({
  routeSegments,
}: {
  routeSegments: string[];
}) {
  const nav = useTranslations("nav");
  const settingsSection = routeSegments[1];
  const isPreferences = settingsSection === "preferences";
  const isDeployment = settingsSection === "deployment";
  const active = isPreferences
    ? "preferences"
    : isDeployment
      ? "deployment"
      : "workspace";
  const content = isPreferences ? (
    <PreferencesSettingsLoading />
  ) : isDeployment ? (
    <DeploymentSettingsLoading />
  ) : settingsSection === "workspace" && routeSegments[2] === "members" ? (
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

function InboxAuthPendingSkeleton() {
  const nav = useTranslations("nav");
  return (
    <div className="flex h-full min-w-0 flex-col">
      <PageHeader title={nav("inbox")} />
      <PageBody width="full">
        <NotificationInboxSkeleton />
      </PageBody>
    </div>
  );
}

function AuthPendingContent({
  routeSegments,
  searchParams,
}: {
  routeSegments: string[];
  searchParams: string;
}) {
  const route = routeSegments[0];
  if (route === "issues" && routeSegments.length === 2) {
    return (
      <IssueDetailAuthPendingSkeleton
        issueId={routeSegments[1] ?? ""}
        searchParams={searchParams}
      />
    );
  }
  if (route === "settings") {
    return <SettingsAuthPendingSkeleton routeSegments={routeSegments} />;
  }
  if (
    route === "planning" &&
    routeSegments[1] === "sprints" &&
    routeSegments.length === 3
  ) {
    return <SprintDetailPageSkeleton />;
  }
  if (route === "planning" && routeSegments.length === 1) {
    return <PlanningPageSkeleton />;
  }
  if (route === "my-work" && routeSegments.length === 1) {
    return <MyWorkPageSkeleton />;
  }
  if (route === "inbox" && routeSegments.length === 1) {
    return <InboxAuthPendingSkeleton />;
  }
  if (route === "reports" && routeSegments.length === 1) {
    return (
      <PageShell>
        <ReportsSkeleton />
      </PageShell>
    );
  }
  if (route === "issues" && routeSegments.length === 1) {
    return <IssuesWorkspaceSkeleton searchParams={searchParams} />;
  }
  return null;
}

function workspaceRouteSegments(pathname: string): string[] {
  const segments = pathname.split("/").filter(Boolean);
  const workspaceIndex = segments.indexOf("workspace");
  return workspaceIndex === -1 ? [] : segments.slice(workspaceIndex + 2);
}

function hasAuthPendingContent(routeSegments: string[]): boolean {
  const route = routeSegments[0];
  const settingsSection = routeSegments[1];
  const isSettingsRoute =
    route === "settings" &&
    (routeSegments.length === 1 ||
      (settingsSection === "workspace" &&
        (routeSegments.length === 2 ||
          (routeSegments.length === 3 && routeSegments[2] === "members"))) ||
      ((settingsSection === "preferences" ||
        settingsSection === "deployment") &&
        routeSegments.length === 2));
  return (
    (route === "issues" &&
      (routeSegments.length === 1 || routeSegments.length === 2)) ||
    isSettingsRoute ||
    (route === "planning" &&
      (routeSegments.length === 1 ||
        (routeSegments[1] === "sprints" && routeSegments.length === 3))) ||
    (route === "my-work" && routeSegments.length === 1) ||
    (route === "inbox" && routeSegments.length === 1) ||
    (route === "reports" && routeSegments.length === 1)
  );
}

function activeNavForPath(routeSegments: string[]) {
  return SIDEBAR_NAV_ITEMS.find(
    ({ href }) => href.slice(1) === routeSegments[0],
  )?.labelKey;
}

/**
 * Auth-pending shell for a vault URL. The protected children stay unmounted;
 * the pathname selects an existing static loading surface so a hard
 * navigation keeps its destination chrome visible while `/auth/me` resolves.
 */
export function WorkspaceAuthPendingSkeleton({
  pathname,
  searchParams = "",
}: {
  pathname: string | null;
  searchParams?: string;
}) {
  const normalizedPathname = pathname ?? "";
  const routeSegments = workspaceRouteSegments(normalizedPathname);
  const hasContent = hasAuthPendingContent(routeSegments);
  const sidebarCollapsed = useViewStore((state) => state.sidebarCollapsed);
  return (
    <AppShellSkeleton
      activeNav={activeNavForPath(routeSegments)}
      sidebarCollapsed={sidebarCollapsed}
      content={
        hasContent ? (
          <AuthPendingContent
            routeSegments={routeSegments}
            searchParams={searchParams}
          />
        ) : undefined
      }
      announce={!hasContent}
    />
  );
}
