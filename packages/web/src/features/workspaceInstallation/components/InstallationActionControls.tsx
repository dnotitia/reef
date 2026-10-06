"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type {
  InstallationCommand,
  WorkspaceInstallationStatus,
} from "../hooks/useWorkspaceInstallationActions";
import { useTranslations } from "next-intl";

interface InstallationActionControlsProps {
  vault: string;
  status: WorkspaceInstallationStatus;
  canManage: boolean;
  canCheckStatus?: boolean;
  busy: boolean;
  activity: "checking" | "requesting" | "finishing" | null;
  acknowledgement: string | null;
  error: string | null;
  canFinish?: boolean;
  onRunCommand: (mode: InstallationCommand) => void;
  onCheckStatus: () => void;
  onFinish?: () => void;
}

export function InstallationActionControls({
  vault,
  status,
  canManage,
  canCheckStatus = false,
  busy,
  activity,
  acknowledgement,
  error,
  canFinish = false,
  onRunCommand,
  onCheckStatus,
  onFinish,
}: InstallationActionControlsProps) {
  const t = useTranslations("workspaceInstallation");
  const canCheck =
    canManage || canCheckStatus || status === "management_required";

  return (
    <div className="flex flex-col gap-2">
      {activity && (
        <span
          className="inline-flex items-center gap-2 type-caption text-muted-foreground"
          role="status"
        >
          <Spinner aria-hidden="true" />
          {t(`activity.${activity}`)}
        </span>
      )}
      {acknowledgement && (
        <p className="text-xs text-muted-foreground" role="status">
          {acknowledgement}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive-text" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {canManage && status === "not_installed" && (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => onRunCommand("install")}
            data-testid={`installation-${vault}-approve`}
          >
            {t("button.install")}
          </Button>
        )}
        {canManage && status === "uninstalled" && (
          <>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => onRunCommand("restore")}
              data-testid={`installation-${vault}-restore`}
            >
              {t("button.restore")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onRunCommand("fresh")}
              data-testid={`installation-${vault}-fresh`}
            >
              {t("button.fresh")}
            </Button>
          </>
        )}
        {canCheck && status !== "ready" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onCheckStatus}
          >
            {t("button.checkStatus")}
          </Button>
        )}
        {canFinish && onFinish && (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={onFinish}
            data-testid={`installation-${vault}-finish`}
          >
            {t("button.finish")}
          </Button>
        )}
      </div>
    </div>
  );
}
