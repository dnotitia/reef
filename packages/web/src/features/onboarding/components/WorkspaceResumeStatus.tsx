"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { WorkspaceAutoResumeStatus } from "@/features/onboarding/hooks/useWorkspaceAutoResume";
import { useTranslations } from "next-intl";

interface WorkspaceResumeStatusProps {
  status: WorkspaceAutoResumeStatus;
  onRetry: () => void;
}

export function WorkspaceResumeStatus({
  status,
  onRetry,
}: WorkspaceResumeStatusProps) {
  const t = useTranslations("onboarding");

  if (status === "error") {
    return (
      <div
        className="flex w-full max-w-md flex-col items-center gap-3 rounded-md border border-border bg-elevated p-5 text-center"
        role="alert"
        data-testid="workspace-resume-error"
      >
        <p className="text-sm text-foreground">{t("workspaceLoadError")}</p>
        <Button type="button" variant="outline" onClick={onRetry}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <output
      className="flex items-center gap-2 text-sm text-muted-foreground"
      aria-live="polite"
      data-testid="workspace-resume-loading"
    >
      <Spinner aria-hidden="true" />
      <span>{t("checkingWorkspaces")}</span>
    </output>
  );
}
