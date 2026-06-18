import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { akbEnsureReefTables, akbListRecentActivity } from "@reef/core";

/**
 * Vault-wide recent issue-change feed (REEF-077). Returns the `reef_activity`
 * events (REEF-063 stream), newest-first, each joined to its issue title, so the
 * Activity hub can merge informational changes with the AI review inbox. An
 * optional `since` query param (the browser-local `last_visit_at` marker) bounds
 * the feed to "what changed since you were last here".
 */
export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();
  const { searchParams } = new URL(request.url);
  const since = searchParams.get("since") ?? undefined;

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    await akbEnsureReefTables({ adapter, vault });
    const events = await akbListRecentActivity(
      adapter,
      vault,
      since ? { since } : {},
    );
    return Response.json({ events }, { status: 200 });
  } catch (err) {
    logger.error({ err, vault }, "list_recent_activity failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
