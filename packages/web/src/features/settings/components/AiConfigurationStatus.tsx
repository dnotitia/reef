"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useAiAvailable } from "@/features/settings/hooks/useAiAvailable";
import { useTranslations } from "next-intl";

export function AiConfigurationStatus() {
  const t = useTranslations("settings.config");
  const { isAvailable, isLoading, model } = useAiAvailable();

  if (isLoading) {
    // Placeholder for the resolved status line (dot + configured · model), so the
    // panel reads as loading rather than a bare text line (REEF-255).
    return <Skeleton data-testid="ai-status-skeleton" className="h-4 w-44" />;
  }

  if (!isAvailable) {
    return (
      <div className="rounded-md border border-status-in-progress/40 bg-status-in-progress/5 px-3 py-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{t("ai.notConfigured")}</p>
        <p>{t("ai.notConfiguredHelp")}</p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="inline-block h-2 w-2 rounded-full bg-status-done" />
      <span>{`${t("ai.configured")} · ${model ?? t("ai.configured")}`}</span>
    </div>
  );
}
