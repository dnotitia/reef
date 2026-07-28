import type { EnrichedVaultSummary } from "@reef/core";

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function selectConfiguredWorkspace(
  vaults: ReadonlyArray<EnrichedVaultSummary>,
  rememberedVault: string,
): string | null {
  const configuredNames = vaults
    .filter((vault) => vault.has_reef_config)
    .map((vault) => vault.name)
    .toSorted(compareAscii);

  if (configuredNames.includes(rememberedVault)) return rememberedVault;
  return configuredNames[0] ?? null;
}
