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

const MAX_RESULTS = 10;

/**
 * GET /api/vault-members?vault={vault}&q={query}
 *
 * Returns workspace members for the AssigneeCombobox typeahead. `q` filters
 * by `username` / `display_name` substring (case insensitive). Empty `q` →
 * the full member list, capped at {@link MAX_RESULTS}.
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
    const users = filterVaultMembers(members, query)
      .slice(0, MAX_RESULTS)
      .map(vaultMemberToCollaborator);
    return Response.json({ users });
  } catch (err) {
    logger.error({ err, vault }, "vault_members failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
