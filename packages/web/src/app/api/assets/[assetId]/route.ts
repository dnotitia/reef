import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import {
  akbDiscardDocumentAsset as discardDocumentAsset,
  akbReadDocumentAsset as readDocumentAsset,
} from "@reef/core";

const IMAGE_CONTENT_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function assetQuery(request: Request): {
  vault: string;
  document?: string;
  commit?: string;
} | null {
  const url = new URL(request.url);
  const vault = parseVaultParam(request);
  if (!vault) return null;
  const document = url.searchParams.get("document")?.trim() || undefined;
  const commit = url.searchParams.get("commit")?.trim() || undefined;
  return { vault, document, commit };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const { assetId } = await params;
  const query = assetQuery(request);
  if (!query) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const asset = await runRouteSpan({
      name: "route.read_document_asset",
      attributes: { vault: query.vault, asset_id: assetId },
      run: () =>
        readDocumentAsset({
          adapter,
          vault: query.vault,
          assetId,
          document: query.document,
          commit: query.commit,
        }),
    });
    const contentType = asset.contentType
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (!contentType || !IMAGE_CONTENT_TYPES.has(contentType)) {
      return new Response("Unsupported document asset type", { status: 415 });
    }
    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      Vary: "Authorization",
    });
    if (asset.contentLength !== null) {
      headers.set("Content-Length", String(asset.contentLength));
    }
    return new Response(asset.body, { headers });
  } catch (err) {
    logger.error(
      { err, vault: query.vault, assetId },
      "read_document_asset failed",
    );
    return respondWithError(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const { assetId } = await params;
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const result = await runRouteSpan({
      name: "route.discard_document_asset",
      attributes: { vault, asset_id: assetId },
      run: () => discardDocumentAsset(adapter, vault, assetId),
    });
    return Response.json(result);
  } catch (err) {
    logger.error({ err, vault, assetId }, "discard_document_asset failed");
    return respondWithError(err);
  }
}
