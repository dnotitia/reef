"use client";

import { VaultPickerInput } from "@/features/settings/components/VaultPickerInput";
import {
  useActiveVault,
  useSetActiveVault,
} from "@/features/settings/hooks/useActiveVault";
import { useVaults } from "@/features/settings/hooks/useVaults";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { CreateWorkspaceForm } from "./CreateWorkspaceForm";

/**
 * Single-screen onboarding for new projects, with existing reef workspaces as
 * a secondary path.
 *
 * Required greenfield step: create or initialize an akb vault and write its
 * reef config (a row in the vault's `reef_settings` table, plus any
 * `monitored_repos` rows). The create form is the shared CreateWorkspaceForm,
 * which the sidebar "New workspace" dialog reuses (REEF-146). GitHub monitored
 * repos remain optional; AI is configured at deployment level and shown as
 * unavailable if the server lacks OpenRouter settings.
 */
export function OnboardingPanel() {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const vaultsQuery = useVaults();
  const { vault: activeVault, isLoading: activeVaultLoading } =
    useActiveVault();
  const setActiveVault = useSetActiveVault();

  const reefVaults = useMemo(
    () => (vaultsQuery.data ?? []).filter((v) => v.has_reef_config),
    [vaultsQuery.data],
  );

  const isLoading = vaultsQuery.isPending || activeVaultLoading;
  const canContinueExisting =
    activeVault.length > 0 && reefVaults.some((v) => v.name === activeVault);

  return (
    <div
      className="flex w-full max-w-2xl flex-col gap-6"
      data-testid="onboarding-panel"
    >
      <section className="flex flex-col gap-4 rounded-md border border-border bg-elevated p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("createWorkspaceTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("createWorkspaceSubtitle")}
          </p>
        </div>

        <CreateWorkspaceForm idPrefix="greenfield" />
      </section>

      <details
        className="group rounded-md border border-border bg-elevated"
        data-testid="onboarding-existing-section"
      >
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-foreground">
          {t("existingWorkspace")}
        </summary>
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {t("existingWorkspaceHint")}
          </p>
          {reefVaults.length === 0 && !isLoading && !vaultsQuery.isError ? (
            <div
              className="text-sm text-muted-foreground"
              data-testid="onboarding-empty-state"
            >
              {t("existingWorkspaceEmpty")}
            </div>
          ) : (
            <VaultPickerInput
              vaults={reefVaults}
              value={activeVault}
              onChange={(next) => void setActiveVault.mutateAsync(next)}
              isLoading={isLoading}
              isError={vaultsQuery.isError}
              placeholder={t("existingWorkspacePlaceholder")}
            />
          )}
          <button
            type="button"
            disabled={!canContinueExisting}
            onClick={() => router.push("/issues")}
            data-testid="onboarding-continue-btn"
            className="w-fit rounded-md bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors duration-150 hover:bg-foreground/90 disabled:opacity-50"
          >
            {t("continueToWorkspace")}
          </button>
        </div>
      </details>
    </div>
  );
}
