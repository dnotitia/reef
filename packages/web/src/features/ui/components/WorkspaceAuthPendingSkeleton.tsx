"use client";

import { AppShellSkeleton } from "@/components/AppShellSkeleton";
import {
  SEGMENTED_CONTROL_ITEM,
  SEGMENTED_CONTROL_ITEM_ACTIVE,
  SEGMENTED_CONTROL_ITEM_INACTIVE,
  SEGMENTED_CONTROL_TRACK,
} from "@/components/segmentedControl";
import { IssueDetailSkeleton } from "@/features/issues/components/detail/IssueDetailSkeleton";
import { IssueChromeIdentity } from "@/features/issues/components/detail/IssueChromeIdentity";
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
import { cn } from "@/lib/utils";
import {
  Building2,
  Maximize2,
  Server,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

function IssueDetailAuthPendingSkeleton({
  issueId,
  searchParams,
}: {
  issueId: string;
  searchParams: string;
}) {
  return (
    <div className="relative h-full min-h-0 min-w-0">
      <IssuesWorkspaceSkeleton searchParams={searchParams} />
      <div
        className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-[2px]"
        aria-hidden="true"
      />
      <div
        data-testid="issue-detail-modal"
        className="issue-detail-sheet fixed inset-y-0 right-0 z-50 flex min-w-0 flex-col overflow-hidden border-l border-border-subtle bg-surface-elevated shadow-xl shadow-foreground/10"
        style={{
          width: "min(94vw, var(--issue-detail-width-default))",
          maxWidth: "var(--issue-detail-width-default)",
        }}
      >
        <div
          data-testid="issue-detail-chrome"
          className="issue-detail-chrome flex items-center gap-2 px-6 pt-4 max-[480px]:pb-1"
        >
          <IssueChromeIdentity
            issueId={issueId}
            status={undefined}
            issueType={undefined}
            parentId={null}
            allIssues={[]}
            allIssuesPending
          />
          <div className="issue-detail-actions flex shrink-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground"
            >
              <Maximize2 className="h-4 w-4" />
            </span>
            <span
              aria-hidden="true"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </span>
          </div>
        </div>
        <div
          data-testid="issue-detail-scroll"
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
        >
          <IssueDetailSkeleton />
        </div>
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
  return (
    (route === "issues" &&
      (routeSegments.length === 1 || routeSegments.length === 2)) ||
    route === "settings" ||
    (route === "planning" &&
      (routeSegments.length === 1 ||
        (routeSegments[1] === "sprints" && routeSegments.length === 3))) ||
    (route === "my-work" && routeSegments.length === 1) ||
    (route === "inbox" && routeSegments.length === 1) ||
    (route === "reports" && routeSegments.length === 1)
  );
}

function activeNavForPath(routeSegments: string[]) {
  switch (routeSegments[0]) {
    case "issues":
      return "issues" as const;
    case "my-work":
      return "myWork" as const;
    case "inbox":
      return "inbox" as const;
    case "planning":
      return "planning" as const;
    case "reports":
      return "reports" as const;
    case "settings":
      return "settings" as const;
    default:
      return undefined;
  }
}

/**
 * Auth-pending shell for a vault URL. The protected children stay unmounted;
 * only the pathname selects an existing static loading surface so a hard
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
  return (
    <AppShellSkeleton
      activeNav={activeNavForPath(routeSegments)}
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
