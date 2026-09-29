import type { DeleteVaultParams } from "../core/types";
import { withSpan } from "../core/tracing";

/** Permanently delete an entire AKB vault after its separate confirmation flow. */
export async function deleteVault(params: DeleteVaultParams): Promise<void> {
  const { adapter, vault, actor } = params;
  return withSpan("akb.delete_vault", { vault, actor }, async () => {
    await adapter.request(`/api/v1/vaults/${encodeURIComponent(vault)}`, {
      method: "DELETE",
      resource: `vault ${vault}`,
    });
  });
}
