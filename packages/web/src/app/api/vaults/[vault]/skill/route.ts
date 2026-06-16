import {
  VAULT_NAME_RE,
  getAkbAdapter,
  missingVaultParamResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import {
  VaultSkillStatusSchema,
  akbGetVaultSkillStatus as getVaultSkillStatus,
  akbInstallReefVaultSkill as installReefVaultSkill,
} from "@reef/core";

/**
 * GET /api/vaults/[vault]/skill → VaultSkillStatus
 *
 * Compares the vault's stamped agent-playbook version against the running
 * release. Backs the Settings "Workspace AI Instructions" section. `can_write`
 * is intentionally not returned — the client derives it from the vault role it
 * already holds; POST is the real authorization guard.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ vault: string }> },
): Promise<Response> {
  const { vault } = await params;
  if (!VAULT_NAME_RE.test(vault)) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const status = await getVaultSkillStatus({ adapter, vault });
    return Response.json(VaultSkillStatusSchema.parse(status));
  } catch (err) {
    logger.error({ err, vault }, "get_vault_skill_status failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}

/**
 * POST /api/vaults/[vault]/skill → VaultSkillStatus
 *
 * Re-applies the current release's skill documents to the vault and re-stamps
 * the version. Last-write-wins: this overwrites the workspace skill docs for
 * everyone and replaces manual edits with the release defaults (the client
 * confirms that before calling). akb enforces `writer` on the underlying
 * writes; the adapter folds akb 401/403 into one `AuthError`, so a reader's
 * rejection surfaces as a 401-class "sign in again" response, not a distinct
 * 403. The client's role-derived `canWrite` gate is the primary block for
 * readers — this server check is the backstop for a stale role or a direct API
 * call.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ vault: string }> },
): Promise<Response> {
  const { vault } = await params;
  if (!VAULT_NAME_RE.test(vault)) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    // Downgrade guard at the mutation boundary: does not overwrite a vault stamped
    // by a NEWER deployment (mixed-version rollout, revert, or a stale/direct
    // POST handled by an older pod). The installer would replace newer docs and
    // stamp this older version. This mirrors GET's "newer is up to date"
    // invariant where it actually matters — the write path — since the client
    // gate alone does not stop a stale or direct call.
    const before = await getVaultSkillStatus({ adapter, vault });
    if (
      before.installed_version !== null &&
      before.installed_version > before.current_version
    ) {
      return Response.json(VaultSkillStatusSchema.parse(before));
    }

    await installReefVaultSkill({ adapter, vault });
    const status = await getVaultSkillStatus({ adapter, vault });
    return Response.json(VaultSkillStatusSchema.parse(status));
  } catch (err) {
    logger.error({ err, vault }, "install_reef_vault_skill failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
