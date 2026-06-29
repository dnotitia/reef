import {
  VAULT_NAME_RE,
  getAkbAdapter,
  getAkbCurrentActor,
  missingVaultParamResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { akbDetachReef as detachReef } from "@reef/core";

/**
 * DELETE /api/vaults/[vault]/reef → { detached: true }
 *
 * Removes the reef layer — issues, planning, activity, comments, templates, and
 * the vault-skill docs — from a vault while leaving the akb vault and any
 * non-reef content intact (REEF-322 detach). Dropping reef tables needs akb
 * admin (403 → AuthError); the client gates the control to the owner. The vault
 * survives, so detach is also recorded by core's `akb.detach_reef` span; this
 * line is the stdout audit (AC5).
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
    { vault, actor, op: "workspace.detach" },
    "reef detach requested",
  );

  try {
    await detachReef({ adapter, vault, actor });
    logger.warn({ vault, actor, op: "workspace.detach" }, "reef detached");
    return Response.json({ detached: true });
  } catch (err) {
    logger.error({ err, vault }, "detach_reef failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
