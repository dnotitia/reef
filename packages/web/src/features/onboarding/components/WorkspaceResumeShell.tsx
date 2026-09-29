"use client";

import { AppShellSkeleton } from "@/components/AppShellSkeleton";
import type { WorkspaceAutoResumeStatus } from "@/features/onboarding/hooks/useWorkspaceAutoResume";
import { WorkspaceResumeStatus } from "./WorkspaceResumeStatus";

export function WorkspaceResumeShell({
  status,
  onRetry,
}: {
  status: WorkspaceAutoResumeStatus;
  onRetry: () => void;
}) {
  if (status !== "error") return <AppShellSkeleton />;

  return (
    <AppShellSkeleton
      announce={false}
      content={
        <div className="flex h-full items-center justify-center p-6">
          <WorkspaceResumeStatus status={status} onRetry={onRetry} />
        </div>
      }
    />
  );
}
