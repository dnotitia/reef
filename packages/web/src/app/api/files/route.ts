import { localizedErrorResponse } from "@/lib/api/errorLocalization";
import {
  getWorkspaceAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import { akbDownloadResourceFile, AkbFileUriSchema } from "@reef/core";

const SAFE_INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

function contentDisposition(
  filename: string,
  disposition: "attachment" | "inline",
): string {
  return `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function normalizedContentType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const url = new URL(request.url);
  const fileUri = url.searchParams.get("uri");
  if (
    !fileUri ||
    !AkbFileUriSchema.safeParse(fileUri).success ||
    !fileUri.startsWith(`akb://${vault}/`)
  ) {
    return localizedErrorResponse("invalidBody", 400);
  }
  const download = url.searchParams.get("download") === "1";

  const adapterResult = await getWorkspaceAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const result = await runRouteSpan({
      name: "route.download_akb_resource_file",
      attributes: { vault },
      run: () => akbDownloadResourceFile({ adapter, vault, fileUri }),
    });
    const contentType = normalizedContentType(result.contentType);
    if (!download && !SAFE_INLINE_IMAGE_TYPES.has(contentType)) {
      return localizedErrorResponse("attachmentTypeBlocked", 415);
    }
    return new Response(result.body, {
      headers: {
        "Content-Type": download ? result.contentType : contentType,
        "Content-Disposition": contentDisposition(
          result.filename ?? "download",
          download ? "attachment" : "inline",
        ),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    logger.error({ err, vault }, "download_akb_resource_file failed");
    return respondWithError(err);
  }
}
