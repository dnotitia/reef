import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import { akbGetDocumentAssetPolicy as getDocumentAssetPolicy } from "@reef/core";

export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const policy = await runRouteSpan({
      name: "route.get_document_asset_policy",
      attributes: { vault },
      run: () => getDocumentAssetPolicy(adapter, vault),
    });
    return Response.json(policy);
  } catch (err) {
    logger.error({ err, vault }, "get_document_asset_policy failed");
    return respondWithError(err);
  }
}
