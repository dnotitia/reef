import { localizedErrorResponse } from "@/lib/api/errorLocalization";
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
import { akbDownloadIssueAttachmentByFileUri as downloadIssueAttachmentByFileUri } from "@reef/core";

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isValidIssueIdPathParam(id)) return invalidIssueIdResponse();

  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const url = new URL(request.url);
  const fileUri = url.searchParams.get("uri");
  if (!fileUri) return new Response("Missing uri", { status: 400 });
  const download = url.searchParams.get("download") === "1";

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const result = await runRouteSpan({
      name: "route.download_issue_attachment_by_file_uri",
      attributes: { vault, issue_id: id },
      run: () =>
        downloadIssueAttachmentByFileUri({
          adapter,
          vault,
          reefId: id,
          fileUri,
        }),
    });
    const contentType = normalizedContentType(result.contentType);
    if (!download && !SAFE_INLINE_IMAGE_TYPES.has(contentType)) {
      return localizedErrorResponse("attachmentTypeBlocked", 415);
    }
    return new Response(result.body, {
      headers: {
        "Content-Type": download ? result.contentType : contentType,
        "Content-Disposition": contentDisposition(
          result.filename ?? result.attachment.filename,
          download ? "attachment" : "inline",
        ),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    logger.error(
      { err, vault, id },
      "download_issue_attachment_by_file_uri failed",
    );
    return respondWithError(err, { resourceKind: "issue" });
  }
}
