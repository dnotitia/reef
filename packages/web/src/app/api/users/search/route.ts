import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import {
  akbListVaults as listVaults,
  akbSearchUsers as searchUsers,
} from "@reef/core";

const MAX_RESULTS = 10;
const ADMIN_ROLES = new Set(["admin", "owner"]);

/**
 * GET /api/users/search?vault={vault}&q={query} → { users: { username, display_name }[] }
 *
 * Searches the GLOBAL akb user directory for the add-member picker (REEF-179) so
 * admins can find users who are not yet in the workspace. Two guards live here,
 * not just in the UI:
 *  - akb's own `/users/search` is open to any authenticated user, so this route
 *    enforces an admin/owner floor on the named workspace — otherwise any
 *    reader/writer session could enumerate the directory (autoreview P2).
 *  - the response is trimmed to `username` + `display_name`; email and other PII
 *    the directory carries are not returned, since the picker renders the
 *    name and handle.
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
    const { vaults } = await listVaults({ adapter });
    const role = vaults.find((v) => v.name === vault)?.role ?? null;
    if (!role || !ADMIN_ROLES.has(role)) {
      return Response.json(
        { error: "You need admin access to search for members to add." },
        { status: 403 },
      );
    }

    const { users } = await searchUsers({ adapter, query, limit: MAX_RESULTS });
    return Response.json({
      users: users.map((u) => ({
        username: u.username,
        display_name: u.display_name ?? null,
      })),
    });
  } catch (err) {
    logger.error({ err, vault }, "search_users failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
