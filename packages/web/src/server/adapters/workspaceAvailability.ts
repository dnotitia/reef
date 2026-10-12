import {
  akbGetMe,
  akbListAdminActiveInstallations,
  type AkbAdapter,
  type VaultSummary,
} from "@reef/core";
import { readWorkspaceInstallationActive } from "./workspaceInstallation";

/** Use AKB's complete admin inventory instead of one request per accessible vault. */
export async function readWorkspaceAvailabilities(params: {
  adapter: AkbAdapter;
  appId: string;
  vaults: readonly VaultSummary[];
}): Promise<PromiseSettledResult<boolean | null>[]> {
  try {
    const { profile } = await akbGetMe({ adapter: params.adapter });
    if (profile.is_admin === true) {
      const installations = await akbListAdminActiveInstallations({
        adapter: params.adapter,
        appId: params.appId,
      });
      const activeIds = new Set(installations.map((item) => item.vaultId));
      return params.vaults.map((vault) => ({
        status: "fulfilled",
        value: vault.id ? activeIds.has(vault.id) : null,
      }));
    }
  } catch (reason) {
    // Preserve failures so each consumer can enforce its own boundary:
    // listings retain unknown availability; personal reads fail closed.
    return params.vaults.map(() => ({ status: "rejected", reason }));
  }
  return Promise.allSettled(
    params.vaults.map((vault) =>
      readWorkspaceInstallationActive({
        adapter: params.adapter,
        appId: params.appId,
        vault,
      }),
    ),
  );
}
