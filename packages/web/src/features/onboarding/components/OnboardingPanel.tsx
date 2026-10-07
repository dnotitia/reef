"use client";

import type { WorkspaceAutoResumeStatus } from "@/features/onboarding/hooks/useWorkspaceAutoResume";
import { useTranslations } from "next-intl";
import { CreateWorkspaceForm } from "./CreateWorkspaceForm";
import { WorkspaceResumeStatus } from "./WorkspaceResumeStatus";

/**
 * Single-screen onboarding for new projects. Active workspaces and remembered
 * unavailable workspaces are routed before this panel renders, so this surface
 * creates a workspace.
 *
 * Required greenfield step: create a new AKB vault, request Reef's app
 * installation, then write the workspace config. The shared
 * CreateWorkspaceForm is also used by the sidebar "New workspace" dialog
 * (REEF-146). GitHub monitored repos remain optional; AI is configured at
 * deployment level and shown as unavailable if the server lacks LLM settings.
 */
export function OnboardingPanel({
  resumeState,
}: {
  resumeState: {
    status: WorkspaceAutoResumeStatus;
    retry: () => void;
  };
}) {
  const t = useTranslations("onboarding");

  if (resumeState.status !== "empty") {
    return (
      <WorkspaceResumeStatus
        status={resumeState.status}
        onRetry={resumeState.retry}
      />
    );
  }

  return (
    <div
      className="flex w-full max-w-2xl flex-col gap-6"
      data-testid="onboarding-panel"
    >
      <section className="flex flex-col gap-4 rounded-md border border-border bg-surface-elevated p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("createWorkspaceTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("createWorkspaceSubtitle")}
          </p>
        </div>

        <CreateWorkspaceForm idPrefix="greenfield" />
      </section>
    </div>
  );
}
