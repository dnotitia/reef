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
import { akbListIssueBodyHistory as listIssueBodyHistory } from "@reef/core";

/** GET /api/issues/[id]/history?vault={vault} → { history } */
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
    const history = await runRouteSpan({
      name: "route.list_issue_body_history",
      attributes: { vault, issue_id: id },
      run: () => listIssueBodyHistory(adapter, vault, id),
    });
    return Response.json({ history });
  } catch (err) {
    logger.error({ err, vault, id }, "list_issue_body_history failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}
