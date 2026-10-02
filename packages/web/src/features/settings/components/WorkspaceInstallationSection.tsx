"use client";

import { useWorkspaceAccess } from "@/features/settings/hooks/useWorkspaceAccess";
import { useVaults } from "@/features/settings/hooks/useVaults";
import { useTranslations } from "next-intl";
import { WorkspaceInstallationActions } from "@/features/onboarding/components/WorkspaceInstallationActions";
import { WorkspaceInstallationLoading } from "@/features/onboarding/components/WorkspaceInstallationLoading";

export function WorkspaceInstallationSection({ vault }: { vault: string }) {
  const t = useTranslations("settings.routes");
  const { role, isResolving } = useWorkspaceAccess(vault);
  const vaultsQuery = useVaults();
  const workspaces = vaultsQuery.data ?? [];
  const workspace = workspaces.find((entry) => entry.name === vault);
  const canManage = role === "owner" || role === "admin";
  const otherInstallations = workspaces.filter(
    (entry) => entry.name !== vault && entry.installation_status !== "ready",
  );

  if (!vault) return null;
  if (isResolving) return <WorkspaceInstallationLoading />;
  if (!workspace) return null;

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="workspace-installation-heading"
    >
      <h3
        id="workspace-installation-heading"
        className="type-settings-section text-muted-foreground"
      >
        {t("general.installation")}
      </h3>
      <WorkspaceInstallationActions
        key={`${vault}:${canManage ? "manager" : "member"}`}
        vault={vault}
        initialStatus={workspace.installation_status}
        canManage={canManage}
      />
      {otherInstallations.length > 0 && (
        <div className="flex flex-col gap-3">
          <h4 className="type-settings-section text-muted-foreground">
            {t("general.otherInstallations")}
          </h4>
          {otherInstallations.map((entry) => (
            <WorkspaceInstallationActions
              key={`${entry.name}:${entry.role === "owner" || entry.role === "admin" ? "manager" : "member"}`}
              vault={entry.name}
              initialStatus={entry.installation_status}
              canManage={entry.role === "owner" || entry.role === "admin"}
            />
          ))}
        </div>
      )}
    </section>
  );
}
