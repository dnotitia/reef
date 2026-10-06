"use client";

import { InstallationActionControls } from "@/features/workspaceInstallation/components/InstallationActionControls";
import { useWorkspaceInstallationActions } from "@/features/workspaceInstallation/hooks/useWorkspaceInstallationActions";
import { useTranslations } from "next-intl";

interface WorkspaceSetupApprovalProps {
  vault: string;
  onReady: () => Promise<void>;
}

export function WorkspaceSetupApproval({
  vault,
  onReady,
}: WorkspaceSetupApprovalProps) {
  const t = useTranslations("workspaceInstallation");
  const actions = useWorkspaceInstallationActions({
    vault,
    initialStatus: "not_installed",
    canManage: true,
    onReady,
  });

  return (
    <div
      className="flex flex-col gap-3"
      data-testid={`workspace-setup-approval-${vault}`}
    >
      <p className="text-sm text-muted-foreground">
        {t(`nextAction.${actions.status}`)}
      </p>
      <InstallationActionControls
        vault={vault}
        status={actions.status}
        canManage
        busy={actions.busy}
        activity={actions.activity}
        acknowledgement={actions.acknowledgement}
        error={actions.error}
        canFinish={actions.canFinish}
        onRunCommand={(mode) => void actions.runCommand(mode)}
        onCheckStatus={() => void actions.checkStatus()}
        onFinish={() => void actions.finishWorkspace()}
      />
    </div>
  );
}
