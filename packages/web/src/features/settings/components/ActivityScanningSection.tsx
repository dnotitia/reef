"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import {
  useProjectConfig,
  useUpdateProjectConfig,
} from "@/features/settings/hooks/useProjectConfig";
import { DEFAULT_CONFIG } from "@reef/core";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ReadOnlyValue } from "./ReadOnlyValue";

/**
 * Workspace AI-activity-scanning kill switch (REEF-313). A team-shared setting
 * persisted in akb `reef_settings`, so it sits with the other admin-managed
 * workspace settings and gates the scan for everyone — not a per-user browser
 * preference. Non-admin viewers see the current state read-only.
 */
export function ActivityScanningSection({
  canEdit = true,
}: {
  canEdit?: boolean;
}) {
  const t = useTranslations("settings.config");
  const { vault: activeVault, isLoading: vaultLoading } = useActiveVault();
  const configQuery = useProjectConfig(activeVault);
  const updateConfig = useUpdateProjectConfig(activeVault);
  const [error, setError] = useState<string | null>(null);

  const enabled =
    configQuery.data?.config.ai_scanning_enabled ??
    DEFAULT_CONFIG.ai_scanning_enabled;
  const isLoading = vaultLoading || configQuery.isPending;

  if (!vaultLoading && !activeVault) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="activity-scanning-no-vault"
      >
        {t("activityScanning.noVault")}
      </p>
    );
  }

  if (configQuery.error) {
    return (
      <p
        role="alert"
        className="text-sm text-destructive"
        data-testid="activity-scanning-load-error"
      >
        {t("loadError")} {configQuery.error.message}
      </p>
    );
  }

  async function handleToggle(next: boolean) {
    setError(null);
    try {
      await updateConfig.mutateAsync({ patch: { ai_scanning_enabled: next } });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("activityScanning.saveError"),
      );
    }
  }

  const stateText = enabled
    ? t("activityScanning.on")
    : t("activityScanning.off");

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="activity-scanning-section"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground/90">
          {t("activityScanning.label")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("activityScanning.description")}
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-5 w-9 rounded-full" />
      ) : canEdit ? (
        <div className="flex items-center gap-3">
          <Switch
            checked={enabled}
            disabled={updateConfig.isPending}
            onCheckedChange={(next) => void handleToggle(next)}
            aria-label={t("activityScanning.toggleLabel")}
            data-testid="activity-scanning-toggle"
          />
          <span
            className="text-sm text-foreground"
            data-testid="activity-scanning-state"
          >
            {stateText}
          </span>
        </div>
      ) : (
        <ReadOnlyValue value={stateText} testId="activity-scanning-readonly" />
      )}

      {error && (
        <p
          role="alert"
          className="text-xs text-destructive"
          data-testid="activity-scanning-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
