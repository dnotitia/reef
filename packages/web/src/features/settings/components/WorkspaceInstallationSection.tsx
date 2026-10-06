"use client";

import { useWorkspaceAccess } from "@/features/settings/hooks/useWorkspaceAccess";
import { useVaults } from "@/features/settings/hooks/useVaults";
import { useTranslations } from "next-intl";
import { InstallationActionControls } from "@/features/workspaceInstallation/components/InstallationActionControls";
import { WorkspaceInstallationLoading } from "@/features/workspaceInstallation/components/WorkspaceInstallationLoading";
import { useWorkspaceInstallationActions } from "@/features/workspaceInstallation/hooks/useWorkspaceInstallationActions";
import { WorkspaceInstallationDetails } from "./WorkspaceInstallationDetails";

export function WorkspaceInstallationSection({
  vault,
  readOnly = false,
}: {
  vault: string;
  readOnly?: boolean;
}) {
  const { role, isResolving } = useWorkspaceAccess(vault);
  const canManage = role === "owner" || role === "admin";

  return (
    <WorkspaceInstallationSectionContent
      key={`${vault}:${canManage ? "manager" : "member"}:${readOnly ? "readonly" : "editable"}`}
      vault={vault}
      role={role}
      isResolving={isResolving}
      readOnly={readOnly}
    />
  );
}

function WorkspaceInstallationSectionContent({
  vault,
  role,
  isResolving,
  readOnly,
}: {
  vault: string;
  role: string | null;
  isResolving: boolean;
  readOnly: boolean;
}) {
  const t = useTranslations("workspaceInstallation");
  const routesT = useTranslations("settings.routes");
  const vaultsQuery = useVaults();
  const workspaces = vaultsQuery.data ?? [];
  const workspace = workspaces.find((entry) => entry.name === vault);
  const canManage = role === "owner" || role === "admin";

  const actions = useWorkspaceInstallationActions({
    vault,
    initialStatus: workspace?.installation_status ?? "unknown",
    canManage: canManage && !readOnly,
    enabled:
      !isResolving &&
      Boolean(workspace) &&
      workspace?.installation_status !== "ready",
  });

  if (!vault) return null;
  if (isResolving) return <WorkspaceInstallationLoading />;
  if (!workspace) return null;
  if (workspace.installation_status === "ready" && !canManage) return null;

  const visibleStatus =
    !canManage && actions.status !== "ready"
      ? "management_required"
      : actions.status;

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="workspace-installation-heading"
      data-testid="workspace-installation-section"
    >
      <h3
        id="workspace-installation-heading"
        className="type-settings-section text-muted-foreground"
      >
        {routesT("general.installation")}
      </h3>
      {workspace.installation_status === "ready" ? (
        <WorkspaceInstallationDetails key={vault} vault={vault} />
      ) : (
        <article
          className="flex flex-col gap-3 rounded-md border border-border-subtle bg-surface-subtle/40 px-4 py-3"
          data-testid={`workspace-installation-${vault}`}
          data-status={visibleStatus}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h4 className="type-control font-medium text-foreground">
              {vault}
            </h4>
            <span className="type-caption text-muted-foreground">
              {t(`status.${visibleStatus}`)}
            </span>
          </div>
          <dl className="grid grid-cols-1 gap-y-2 type-body sm:grid-cols-3 sm:gap-x-4">
            <div>
              <dt className="type-body font-semibold text-foreground">
                {t("label.impact")}
              </dt>
              <dd className="mt-1 text-muted-foreground">
                {t(`impact.${visibleStatus}`)}
              </dd>
            </div>
            <div>
              <dt className="type-body font-semibold text-foreground">
                {t("label.nextAction")}
              </dt>
              <dd className="mt-1 text-muted-foreground">
                {t(`nextAction.${visibleStatus}`)}
              </dd>
            </div>
            <div>
              <dt className="type-body font-semibold text-foreground">
                {t("label.responsible")}
              </dt>
              <dd className="mt-1 text-muted-foreground">
                {t(`responsible.${visibleStatus}`)}
              </dd>
            </div>
          </dl>
          <InstallationActionControls
            vault={vault}
            status={visibleStatus}
            canManage={canManage && !readOnly}
            canCheckStatus={canManage && readOnly}
            busy={actions.busy}
            activity={actions.activity}
            acknowledgement={actions.acknowledgement}
            error={actions.error}
            onRunCommand={(mode) => void actions.runCommand(mode)}
            onCheckStatus={() => void actions.checkStatus()}
          />
          {canManage && <WorkspaceInstallationDetails vault={vault} />}
        </article>
      )}
    </section>
  );
}
