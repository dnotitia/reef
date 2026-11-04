import { readInstallationTarget } from "@/server/adapters/installationTarget";
import {
  akbGetMe,
  akbListAdminActiveInstallations,
  akbListMemberActiveVaults,
  akbListVaults,
  type AkbAdapter,
} from "@reef/core";

/** Resolve the active workspace scope shared by account-wide personal surfaces. */
export async function listActiveWorkspaces(params: {
  adapter: AkbAdapter;
}): Promise<string[]> {
  const target = readInstallationTarget();
  if (!target) return [];
  const { profile } = await akbGetMe({ adapter: params.adapter });
  if (!profile.is_admin) {
    const { vaults } = await akbListMemberActiveVaults({
      adapter: params.adapter,
      appId: target.appId,
    });
    return vaults.map((vault) => vault.name).sort();
  }
  const { vaults } = await akbListVaults({ adapter: params.adapter });
  const installations = await akbListAdminActiveInstallations({
    adapter: params.adapter,
    appId: target.appId,
  });
  const activeIds = new Set(installations.map((item) => item.vaultId));
  return vaults
    .filter((vault) => vault.id && activeIds.has(vault.id))
    .map((vault) => vault.name)
    .sort();
}
