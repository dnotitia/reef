"use client";

import { AppShellSkeleton } from "@/components/AppShellSkeleton";
import { IssuesWorkspaceSkeleton } from "@/features/issues/components/filters/IssuesWorkspaceSkeleton";
import type { WorkspaceAutoResumeStatus } from "@/features/onboarding/hooks/useWorkspaceAutoResume";
import { useViewStore } from "@/features/ui/stores/useViewStore";
import { WorkspaceResumeStatus } from "./WorkspaceResumeStatus";

export function WorkspaceResumeShell({
  status,
  onRetry,
}: {
  status: WorkspaceAutoResumeStatus;
  onRetry: () => void;
}) {
  const sidebarCollapsed = useViewStore((state) => state.sidebarCollapsed);
  return (
    <AppShellSkeleton
      activeNav="issues"
      sidebarCollapsed={sidebarCollapsed}
      announce={false}
      content={
        status === "error" ? (
          <div className="flex h-full items-center justify-center p-6">
            <WorkspaceResumeStatus status={status} onRetry={onRetry} />
          </div>
        ) : (
          <IssuesWorkspaceSkeleton />
        )
      }
    />
  );
}
