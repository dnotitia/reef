import {
  VAULT_NAME_RE,
  getAkbAdapter,
  getAkbCurrentActor,
  missingVaultParamResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { akbRevokeVaultMember as revokeVaultMember } from "@reef/core";

/**
 * DELETE /api/vaults/[vault]/members/[user] → { revoked: true }
 *
 * Revokes a member's access (REEF-179). `[user]` is an akb username (Next
 * decodes the path segment, so non-ASCII usernames round-trip). akb refuses to
 * revoke the vault owner (403 → AuthError); the UI keeps the owner row
 * un-removable so this is does not hit on the normal path. Admin floor is enforced
 * by akb; the client gates the control to admins.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ vault: string; user: string }> },
): Promise<Response> {
  const { vault, user } = await params;
  if (!VAULT_NAME_RE.test(vault)) return missingVaultParamResponse();
  if (!user.trim()) {
    return Response.json(
      { error: "Missing member username." },
      { status: 400 },
    );
  }

  // Block self-removal on the server, not just in the UI. akb permits a
  // non-owner admin to revoke their own access, which would lock them out of the
  // workspace, so the documented "you does not remove yourself" invariant should hold
  // for direct API calls too (autoreview P3).
  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor === user) {
    return Response.json(
      { error: "You can't remove yourself from a workspace." },
      { status: 409 },
    );
  }

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    await revokeVaultMember({ adapter, vault, user });
    return Response.json({ revoked: true });
  } catch (err) {
    logger.error({ err, vault }, "revoke_vault_member failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
