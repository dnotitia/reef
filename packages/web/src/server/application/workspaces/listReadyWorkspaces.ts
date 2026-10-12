import { readWorkspaceInstallationStatus } from "@/server/adapters/workspaceInstallation";
import { readWorkspaceAvailabilities } from "@/server/adapters/workspaceAvailability";
import { readInstallationTarget } from "@/server/adapters/installationTarget";
import { akbListVaults, type AkbAdapter } from "@reef/core";

/** Resolve the ready workspace scope shared by account-wide personal surfaces. */
export async function listReadyWorkspaces(params: {
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
  const checked = await Promise.all(
    vaults.map(async (vault, index) => {
      const active = availability[index];
      if (active.status === "rejected") throw active.reason;
      if (active.value !== true) return null;
      const state = await readWorkspaceInstallationStatus({
        adapter: params.adapter,
        vault,
      });
      return state.installation_status === "ready" ? vault.name : null;
    }),
  );
  return checked.filter((name): name is string => name !== null).sort();
}
