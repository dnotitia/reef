import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import {
  akbFilterVaultMembers as filterVaultMembers,
  akbListVaultMembers as listVaultMembers,
  akbVaultMemberToCollaborator as vaultMemberToCollaborator,
} from "@reef/core";

const ASSIGNABLE_ROLES = new Set(["writer", "admin", "owner"]);

/**
 * GET /api/vault-members?vault={vault}&q={query}
 *
 * Returns workspace members for the AssigneeCombobox typeahead. Members
 * that can receive issue assignments are returned. `q` filters by `username`
 * / `display_name` substring (case insensitive); an empty `q` returns the
 * complete assignable member list without a result cap.
 *
 * Response shape mirrors the older `/api/users/search` envelope (`{ users:
 * Collaborator[] }`) so the client hook and combobox don't need new types.
 * akb has no avatars today — `avatar_url` is consistently `null`.
 *
 * The adapter is per-request; the akb JWT lives in the `__reef_session`
 * httpOnly cookie and does not touches module scope or logs.
 */
export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const { members } = await listVaultMembers({ adapter, vault });
    const users = filterVaultMembers(
      members.filter((member) => ASSIGNABLE_ROLES.has(member.role)),
      query,
    ).map(vaultMemberToCollaborator);
    return Response.json({ users });
  } catch (err) {
    logger.error({ err, vault }, "vault_members failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
