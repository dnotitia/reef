import {
  VAULT_NAME_RE,
  getAkbAdapter,
  getAkbCurrentActor,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  missingVaultParamResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import {
  akbGrantVaultMember as grantVaultMember,
  akbListVaultMembers as listVaultMembers,
} from "@reef/core";
import { z } from "zod";

/**
 * GET /api/vaults/[vault]/members → { members: VaultMember[] }
 *
 * The role-bearing membership roster for the Settings → Workspace → Members
 * view (REEF-179). Distinct from `/api/vault-members`, which projects members
 * down to the role-less `Collaborator` shape for the assignee typeahead — here
 * the role is the whole point, so the full member is returned. Readable by any
 * member (akb enforces reader+); the client gates *management* on admin.
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
    const { members } = await listVaultMembers({ adapter, vault });
    return Response.json({ members });
  } catch (err) {
    logger.error({ err, vault }, "list_vault_roster failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}

/**
 * The grant body. `role` excludes `owner`: akb rejects granting owner (ownership
 * moves just through transfer, out of scope here), and the UI  offers
 * these three. A grant on an existing member is the role-change path (AC3) since
 * akb upserts.
 */
const GrantMemberRequestSchema = z.object({
  user: z.string().min(1),
  role: z.enum(["reader", "writer", "admin"]),
});

/**
 * POST /api/vaults/[vault]/members → { vault, user, role }
 *
 * Grants (or, since akb upserts, re-roles) a member. akb enforces an admin
 * floor; a non-admin caller's rejection folds into one `AuthError` (401-class)
 * — the client's role-derived gate is the primary block, this is the backstop
 * for a stale role or a direct API call.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ vault: string }> },
): Promise<Response> {
  const { vault } = await params;
  if (!VAULT_NAME_RE.test(vault)) return missingVaultParamResponse();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }
  const parsed = GrantMemberRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  // Block self-role-changes on the server, the symmetric guard to DELETE's
  // self-removal block: this route is also the re-role path, so an admin
  // demoting their own role here would lock themselves out of management. The UI
  // already makes the signed-in row read; enforce it for direct API calls
  // too (autoreview P3).
  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor === parsed.data.user) {
    return Response.json(
      { error: "You can't change your own role." },
      { status: 409 },
    );
  }

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const result = await grantVaultMember({
      adapter,
      vault,
      user: parsed.data.user,
      role: parsed.data.role,
    });
    return Response.json(result);
  } catch (err) {
    logger.error({ err, vault }, "grant_vault_member failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
