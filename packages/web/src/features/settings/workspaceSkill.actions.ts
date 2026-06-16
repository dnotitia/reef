import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { type VaultSkillStatus, VaultSkillStatusSchema } from "@reef/core";

/**
 * Re-apply the current release's vault-skill documents to `vault` and return
 * the re-stamped status. Mutation helper for the Settings "update instructions"
 * action — the Route Handler enforces `writer` on the akb side.
 */
export async function applyWorkspaceSkillUpdate(
  vault: string,
): Promise<VaultSkillStatus> {
  const res = await apiFetch(`/api/vaults/${encodeURIComponent(vault)}/skill`, {
    method: "POST",
  });
  if (!res.ok) {
    await throwHttpError(
      res,
      `Failed to update workspace instructions: ${res.status}`,
    );
  }
  return VaultSkillStatusSchema.parse((await res.json()) as unknown);
}
