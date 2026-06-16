import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { akbListPlanningCatalog as listPlanningCatalog } from "@reef/core";

export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const catalog = await listPlanningCatalog({ adapter, vault });
    return Response.json(catalog);
  } catch (err) {
    logger.error({ err, vault }, "list_planning_catalog failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
