import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import { akbGetDocumentAssetMetadata as getDocumentAssetMetadata } from "@reef/core";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const { assetId } = await params;
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();
  const url = new URL(request.url);

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const metadata = await runRouteSpan({
      name: "route.get_document_asset_metadata",
      attributes: { vault, asset_id: assetId },
      run: () =>
        getDocumentAssetMetadata({
          adapter,
          vault,
          assetId,
          document: url.searchParams.get("document")?.trim() || undefined,
          commit: url.searchParams.get("commit")?.trim() || undefined,
        }),
    });
    return Response.json(metadata);
  } catch (err) {
    logger.error({ err, vault, assetId }, "get_document_asset_metadata failed");
    return respondWithError(err);
  }
}
