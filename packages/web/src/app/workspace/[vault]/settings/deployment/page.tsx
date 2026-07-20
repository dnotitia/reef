import { AiConfigurationStatus } from "@/features/settings/components/AiConfigurationStatus";
import { SettingsGroup } from "@/features/settings/components/SettingsGroup";
import { useTranslations } from "next-intl";

/**
 * Settings › Deployment (REEF-183) — operator-managed, read state such as
 * the LLM configuration. Like Preferences, this tab is not workspace-scoped, so
 * it does not mount the Active Workspace selector (AC2).
 */
export default function DeploymentSettingsPage() {
  const t = useTranslations("settings.routes");
  return (
    <SettingsGroup
      title={t("deployment.title")}
      description={t("deployment.description")}
      access="managed"
      testId="settings-group-deployment"
    >
      {/* AI Configuration — deployment-managed LLM status */}
      <section className="flex flex-col gap-3">
        <h3 className="font-display text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("deployment.aiConfiguration")}
        </h3>
        <AiConfigurationStatus />
      </section>
    </SettingsGroup>
  );
}
