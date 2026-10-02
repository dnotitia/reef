"use client";

import { useWorkspaceAutoResume } from "@/features/onboarding/hooks/useWorkspaceAutoResume";
import { useVaults } from "@/features/settings/hooks/useVaults";
import { useTranslations } from "next-intl";
import { CreateWorkspaceForm } from "./CreateWorkspaceForm";
import { WorkspaceResumeStatus } from "./WorkspaceResumeStatus";
import { ExistingWorkspaceOption } from "./ExistingWorkspaceOption";

/**
 * Single-screen onboarding for new projects. Configured workspaces are
 * resumed before this panel renders, so this surface creates a workspace.
 *
 * Required greenfield step: create or select an AKB vault, request Reef's app
 * installation, then write the workspace config. The create form is the shared CreateWorkspaceForm,
 * which the sidebar "New workspace" dialog reuses (REEF-146). GitHub monitored
 * repos remain optional; AI is configured at deployment level and shown as
 * unavailable if the server lacks LLM settings.
 */
export function OnboardingPanel({
  resumeState,
}: {
  resumeState?: ReturnType<typeof useWorkspaceAutoResume>;
} = {}) {
  const t = useTranslations("onboarding");
  const ownResume = useWorkspaceAutoResume({
    enabled: resumeState === undefined,
  });
  const resume = resumeState ?? ownResume;
  const vaultsQuery = useVaults();

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

      {(vaultsQuery.data ?? []).some(
        (vault) => vault.installation_status !== "ready",
      ) && (
        <section
          className="flex flex-col gap-4"
          aria-labelledby="existing-vaults-heading"
        >
          <div className="flex flex-col gap-1">
            <h2
              id="existing-vaults-heading"
              className="type-settings-group text-foreground"
            >
              {t("existingVaultsTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("existingVaultsDescription")}
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {(vaultsQuery.data ?? [])
              .filter((vault) => vault.installation_status !== "ready")
              .map((vault) => {
                const canManage =
                  vault.role === "owner" || vault.role === "admin";
                return (
                  <li
                    key={`${vault.name}:${vault.installation_status}:${canManage ? "manager" : "member"}`}
                  >
                    <ExistingWorkspaceOption
                      vault={vault.name}
                      initialStatus={vault.installation_status}
                      canManage={canManage}
                    />
                  </li>
                );
              })}
          </ul>
        </section>
      )}
    </div>
  );
}
