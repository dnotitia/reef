import {
  getAkbAdapter,
  invalidIssueIdResponse,
  isValidIssueIdPathParam,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import { akbListIssueActivity as listIssueActivity } from "@reef/core";

/**
 * Issue activity log (REEF-063 / REEF-064). `vault` is a query param; the reef
 * id is the `[id]` path segment. Read-— the events are written server-side
 * by `updateIssue` on a status change. The unified timeline (REEF-064) merges
 * this with comments and reconstructed events at render time.
 */

/** GET /api/issues/[id]/activity?vault={vault} → { activity } */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isValidIssueIdPathParam(id)) return invalidIssueIdResponse();

  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const activity = await runRouteSpan({
      name: "route.list_activity",
      attributes: { vault, issue_id: id },
      run: () => listIssueActivity(adapter, vault, id),
    });
    return Response.json({ activity });
  } catch (err) {
    logger.error({ err, vault, id }, "list_activity failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}
