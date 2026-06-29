"use client";

import { Button } from "@/components/ui/button";
import {
  useActiveVault,
  useSetActiveVault,
} from "@/features/settings/hooks/useActiveVault";
import { useVaults } from "@/features/settings/hooks/useVaults";
import { useViewStore } from "@/features/ui/stores/useViewStore";
import { withVault } from "@/lib/workspaceHref";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { VaultPickerInput } from "./VaultPickerInput";

/**
 * Active Workspace — the per-user "which akb vault am I working in" pointer
 * (Dexie). It is NOT a team-shared workspace setting: it SCOPES every
 * vault-scoped setting below it (monitored repos, project prefix, templates,
 * AI instructions). So it sits above the shared "Workspace settings" group as
 * a personal scope context rather than buried inside one of those settings,
 * where it inverted the parent/child relationship and competed with the
 * group's shared-permission framing (REEF-150).
 *
 * The `has_reef_config` filter and the per-user Dexie storage are unchanged
 * from when this lived in RepoPickerSection; the placement and framing
 * moved.
 */
export function ActiveWorkspaceSection() {
  const t = useTranslations("settings.config");
  const vaultsQuery = useVaults();
  // just vaults that already carry a reef config are valid active workspaces:
  // reef reads/writes issues in the active vault, and Settings has no path to
  // initialize a bare vault (onboarding's "Create workspace" does that). Mirror
  // onboarding's `has_reef_config` filter so both surfaces offer the same list
  // instead of selecting into a dead end (empty board / config-load error)
  // (REEF-143).
  const availableVaults = useMemo(
    () => (vaultsQuery.data ?? []).filter((v) => v.has_reef_config),
    [vaultsQuery.data],
  );
  const vaultsLoading = vaultsQuery.isPending;
  const vaultsError = vaultsQuery.isError && !vaultsQuery.data;

  const { vault: activeVault, isLoading: activeVaultLoading } =
    useActiveVault();
  const setActiveVaultMutation = useSetActiveVault();
  const router = useRouter();
  // Shared trigger for the globally-mounted CreateWorkspaceDialog (REEF-146);
  // the sidebar switcher flips the same flag (REEF-147).
  const openCreateWorkspaceDialog = useViewStore(
    (s) => s.openCreateWorkspaceDialog,
  );

  const [saveMessage, setSaveMessage] = useState("");

  const handleVaultSelect = useCallback(
    async (next: string) => {
      if (next === activeVault) return;
      setSaveMessage("");
      // Persist the new default, then NAVIGATE: the active workspace is now the
      // URL `[vault]` segment (REEF-315), so writing Dexie alone would leave the
      // page (and the picker) scoped to the old URL vault and snap back. Routing
      // to the same settings tab under the selected vault re-scopes every
      // surface; picking "none" returns to onboarding.
      try {
        await setActiveVaultMutation.mutateAsync(next);
      } catch {
        setSaveMessage("Failed to save workspace.");
        return;
      }
      router.push(
        next ? withVault(next, "/settings/workspace") : "/onboarding",
      );
    },
    [setActiveVaultMutation, activeVault, router],
  );

  return (
    <section
      data-testid="active-workspace-section"
      aria-labelledby="active-workspace-heading"
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-subtle/50 px-4 py-4"
    >
      <div className="flex flex-col gap-1">
        {/* Heading carries group-tier weight (foreground, 15px), not the muted
            uppercase leaf-label style: this selector scopes the Workspace
            settings below it, so it should not read as smaller than the group it
            governs (REEF-174). */}
        <h2
          id="active-workspace-heading"
          className="font-display text-[15px] font-semibold text-foreground"
        >
          {t("activeWorkspace.heading")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("activeWorkspace.description")}
        </p>
      </div>

      {/* Switch (picker) and create (button) sit adjacent so "manage my
          workspaces" is one place. The create button is deliberately NOT gated
          on the active vault's role: making a new vault isn't an edit to the
          current one, so a read viewer should still reach it — akb makes the
          final call on whether the create succeeds (REEF-147). */}
      <div className="flex flex-wrap items-center gap-2">
        <VaultPickerInput
          vaults={availableVaults}
          value={activeVault}
          onChange={(next) => void handleVaultSelect(next)}
          isLoading={vaultsLoading || activeVaultLoading}
          isError={vaultsError}
          allowNone
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => openCreateWorkspaceDialog()}
          data-testid="active-workspace-create"
        >
          <Plus aria-hidden="true" className="size-3.5 shrink-0" />
          {t("activeWorkspace.newWorkspace")}
        </Button>
      </div>

      {/* Live region is consistently mounted so the async save result is announced
          when it appears; the message paragraph fills it on demand (REEF-174). */}
      <div aria-live="polite" data-testid="active-workspace-save-status">
        {saveMessage && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="active-workspace-save-message"
          >
            {saveMessage}
          </p>
        )}
      </div>
    </section>
  );
}
