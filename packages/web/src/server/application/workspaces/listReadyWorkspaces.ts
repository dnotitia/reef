import { readWorkspaceInstallationStatus } from "@/server/adapters/workspaceInstallation";
import { akbListVaults, type AkbAdapter } from "@reef/core";

/** Resolve the ready workspace scope shared by account-wide personal surfaces. */
export async function listReadyWorkspaces(params: {
  adapter: AkbAdapter;
}): Promise<string[]> {
  const { vaults } = await akbListVaults({ adapter: params.adapter });
  const checked = await Promise.all(
    vaults.map(async (vault) => ({
      vault,
      state: await readWorkspaceInstallationStatus({
        adapter: params.adapter,
        vault,
      }),
    })),
  );
  return checked
    .filter(({ state }) => state.installation_status === "ready")
    .map(({ vault }) => vault.name)
    .sort();
}
