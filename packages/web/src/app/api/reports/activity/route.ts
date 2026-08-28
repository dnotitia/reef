import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import { akbListReportActivity as listReportActivity } from "@reef/core";

/** GET /api/reports/activity?vault={vault} → bulk status-change activity. */
export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const activity = await runRouteSpan({
      name: "route.list_report_activity",
      attributes: { vault },
      run: () => listReportActivity(adapter, vault),
    });
    return Response.json({ activity });
  } catch (err) {
    logger.error({ err, vault }, "list_report_activity failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
