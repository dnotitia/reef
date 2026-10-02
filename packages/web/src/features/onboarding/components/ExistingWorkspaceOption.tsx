"use client";

import { InstallationActionControls } from "@/features/workspaceInstallation/components/InstallationActionControls";
import { useWorkspaceInstallationActions } from "@/features/workspaceInstallation/hooks/useWorkspaceInstallationActions";
import type { WorkspaceInstallationStatus } from "@/features/workspaceInstallation/hooks/useWorkspaceInstallationActions";
import { useTranslations } from "next-intl";

interface ExistingWorkspaceOptionProps {
  vault: string;
  initialStatus: WorkspaceInstallationStatus;
  canManage: boolean;
}

export function ExistingWorkspaceOption({
  vault,
  initialStatus,
  canManage,
}: ExistingWorkspaceOptionProps) {
  const t = useTranslations("workspaceInstallation");
  const actions = useWorkspaceInstallationActions({
    vault,
    initialStatus,
    canManage,
  });
  const visibleStatus =
    !canManage && actions.status !== "ready"
      ? "management_required"
      : actions.status;

  return (
    <article
      className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-subtle/40 px-4 py-3"
      data-testid={`workspace-installation-${vault}`}
      data-status={visibleStatus}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="type-control font-medium text-foreground">{vault}</h3>
        <span className="type-caption text-muted-foreground">
          {t(`status.${visibleStatus}`)}
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">{t("label.impact")}</dt>
          <dd className="mt-0.5 text-muted-foreground">
            {t(`impact.${visibleStatus}`)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("label.nextAction")}
          </dt>
          <dd className="mt-0.5 text-muted-foreground">
            {t(`nextAction.${visibleStatus}`)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("label.responsible")}
          </dt>
          <dd className="mt-0.5 text-muted-foreground">
            {t(`responsible.${visibleStatus}`)}
          </dd>
        </div>
      </dl>
      <InstallationActionControls
        vault={vault}
        status={visibleStatus}
        canManage={canManage}
        busy={actions.busy}
        activity={actions.activity}
        acknowledgement={actions.acknowledgement}
        error={actions.error}
        onRunCommand={(mode) => void actions.runCommand(mode)}
        onCheckStatus={() => void actions.checkStatus()}
      />
    </article>
  );
}
