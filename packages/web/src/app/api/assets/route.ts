import { localizedErrorResponse } from "@/lib/api/errorLocalization";
import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import { akbUploadDocumentAsset as uploadDocumentAsset } from "@reef/core";
import {
  imageFilename,
  imageMimeType,
  readBoundedImageBody,
} from "./routeSupport";

/** POST /api/assets?vault={vault}&filename={name} -> Document Attachment asset */
export async function POST(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  const filename = imageFilename(request);
  const mimeType = imageMimeType(request);
  if (!filename || !mimeType) {
    return localizedErrorResponse("invalidBody", 400);
  }

  const body = await readBoundedImageBody(request);
  if (body === "too_large") {
    return localizedErrorResponse("attachmentTooLarge", 413);
  }
  if (body === "invalid") {
    return localizedErrorResponse("invalidBody", 400);
  }

  try {
    const asset = await runRouteSpan({
      name: "route.upload_document_asset",
      attributes: { vault, size_bytes: body.byteLength },
      run: () =>
        uploadDocumentAsset({
          adapter,
          vault,
          filename,
          mimeType,
          bytes: body,
        }),
    });
    return Response.json(asset, { status: 201 });
  } catch (err) {
    logger.error(
      { err, vault, size_bytes: body.byteLength },
      "upload_document_asset failed",
    );
    return respondWithError(err);
  }
}
