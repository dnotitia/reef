import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import { akbCopyFileToDocumentAsset as copyFileToDocumentAsset } from "@reef/core";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  const { fileId } = await params;
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const asset = await runRouteSpan({
      name: "route.copy_file_to_document_asset",
      attributes: { vault, file_id: fileId },
      run: () => copyFileToDocumentAsset(adapter, vault, fileId),
    });
    return Response.json(asset, { status: 201 });
  } catch (err) {
    logger.error({ err, vault, fileId }, "copy_file_to_document_asset failed");
    return respondWithError(err);
  }
}
