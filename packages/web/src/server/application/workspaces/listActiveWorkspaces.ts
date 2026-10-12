import { readWorkspaceAvailabilities } from "@/server/adapters/workspaceAvailability";
import { readInstallationTarget } from "@/server/adapters/installationTarget";
import { akbListVaults, type AkbAdapter } from "@reef/core";

/** Resolve the active workspace scope shared by account-wide personal surfaces. */
export async function listActiveWorkspaces(params: {
  adapter: AkbAdapter;
}): Promise<string[]> {
  const target = readInstallationTarget();
  if (!target) return [];
  const { vaults } = await akbListVaults({ adapter: params.adapter });
  const availability = await readWorkspaceAvailabilities({
    adapter: params.adapter,
    appId: target.appId,
    vaults,
  });
  return vaults
    .filter((_vault, index) => {
      const active = availability[index];
      if (active.status === "rejected") throw active.reason;
      return active.value === true;
    })
    .map((vault) => vault.name)
    .sort();
}
