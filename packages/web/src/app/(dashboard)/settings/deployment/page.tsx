import { AiConfigurationStatus } from "@/features/settings/components/AiConfigurationStatus";
import { SettingsGroup } from "@/features/settings/components/SettingsGroup";

/**
 * Settings › Deployment (REEF-183) — operator-managed, read state such as
 * the LLM configuration. Like Preferences, this tab is not workspace-scoped, so
 * it does not mount the Active Workspace selector (AC2).
 */
export default function DeploymentSettingsPage() {
  return (
    <SettingsGroup
      title="Deployment"
      description="Managed by the server operator — read-only here."
      access="managed"
      testId="settings-group-deployment"
    >
      {/* AI Configuration — deployment-managed OpenRouter status */}
      <section className="flex flex-col gap-3">
        <h3 className="font-display text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          AI Configuration
        </h3>
        <AiConfigurationStatus />
      </section>
    </SettingsGroup>
  );
}
