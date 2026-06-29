import {
  VAULT_NAME_RE,
  getAkbAdapter,
  getAkbCurrentActor,
  missingVaultParamResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { akbDeleteVault as deleteVault } from "@reef/core";

/**
 * DELETE /api/vaults/[vault] → { deleted: true }
 *
 * Permanently deletes the entire akb vault (REEF-322). akb cascades documents,
 * tables, files, and git history, and enforces the admin/owner floor (403 →
 * AuthError); the client gates the control to the owner and requires a typed
 * name confirmation. The acting user, target vault, and time are written to the
 * audit log BEFORE the irreversible call — the vault's own reef_activity is
 * destroyed by the cascade, so this stdout/OTel line is the surviving record of
 * who deleted which workspace and when (AC5). The username is an operational
 * identity, not a credential.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ vault: string }> },
): Promise<Response> {
  const { vault } = await params;
  if (!VAULT_NAME_RE.test(vault)) return missingVaultParamResponse();

  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  logger.warn(
    { vault, actor, op: "workspace.delete" },
    "workspace delete requested",
  );

  try {
    await deleteVault({ adapter, vault, actor });
    logger.warn({ vault, actor, op: "workspace.delete" }, "workspace deleted");
    return Response.json({ deleted: true });
  } catch (err) {
    logger.error({ err, vault }, "delete_vault failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
