"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { SettingsGroup } from "@/features/settings/components/SettingsGroup";
import { MembersSection } from "@/features/settings/components/members/MembersSection";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useWorkspaceAccess } from "@/features/settings/hooks/useWorkspaceAccess";
import { useTranslations } from "next-intl";

/**
 * Workspace › Members (REEF-183 scaffold, filled by REEF-179) — the second
 * sub-view under the Workspace tab, scoped by the shared Active Workspace
 * selector above. Member management is admin-floored: that gate is distinct from
 * the writer floor of the General settings, since akb requires admin/owner for
 * grant/revoke. Readers and writers see the roster read (AC1/AC5).
 */
export default function WorkspaceMembersPage() {
  const t = useTranslations("settings.routes");
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const { role, isResolving } = useWorkspaceAccess(vault);

  const canManage = role === "admin" || role === "owner";
  // Omit the badge until both the vault and role resolve so a wrong "View just"
  // does not flashes for an admin (mirrors the General page, REEF-174).
  const access =
    vaultLoading || isResolving
      ? undefined
      : canManage
        ? "editable"
        : "view-only";
  const scopeName = vaultLoading || !vault ? undefined : vault;

  return (
    <SettingsGroup
      title={t("members.title")}
      description={t("members.description")}
      access={access}
      scopeName={scopeName}
      testId="settings-group-members"
    >
      {vault ? (
        <MembersSection vault={vault} canManage={canManage} />
      ) : vaultLoading ? (
        <Skeleton className="h-12 w-full" data-testid="members-vault-loading" />
      ) : (
        <p
          className="text-sm text-muted-foreground"
          data-testid="members-no-vault"
        >
          {t("members.noVault")}
        </p>
      )}
    </SettingsGroup>
  );
}
