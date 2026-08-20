"use client";

import { useWorkspaceAutoResume } from "@/features/onboarding/hooks/useWorkspaceAutoResume";
import { useTranslations } from "next-intl";
import { CreateWorkspaceForm } from "./CreateWorkspaceForm";
import { WorkspaceResumeStatus } from "./WorkspaceResumeStatus";

/**
 * Single-screen onboarding for new projects. Configured workspaces are
 * resumed before this panel renders, so this surface only creates a workspace.
 *
 * Required greenfield step: create or initialize an akb vault and write its
 * reef config (a row in the vault's `reef_settings` table, plus any
 * `monitored_repos` rows). The create form is the shared CreateWorkspaceForm,
 * which the sidebar "New workspace" dialog reuses (REEF-146). GitHub monitored
 * repos remain optional; AI is configured at deployment level and shown as
 * unavailable if the server lacks LLM settings.
 */
export function OnboardingPanel() {
  const t = useTranslations("onboarding");
  const resume = useWorkspaceAutoResume();

  if (resume.status !== "empty") {
    return (
      <WorkspaceResumeStatus status={resume.status} onRetry={resume.retry} />
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
