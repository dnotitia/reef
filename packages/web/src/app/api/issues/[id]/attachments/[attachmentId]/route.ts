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
import { akbDownloadIssueAttachment as downloadIssueAttachment } from "@reef/core";

function contentDisposition(filename: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
): Promise<Response> {
  const { id, attachmentId } = await params;
  if (!isValidIssueIdPathParam(id)) return invalidIssueIdResponse();

  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const result = await runRouteSpan({
      name: "route.download_issue_attachment",
      attributes: { vault, issue_id: id },
      run: () =>
        downloadIssueAttachment({
          adapter,
          vault,
          reefId: id,
          attachmentId,
        }),
    });
    return new Response(result.body, {
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": contentDisposition(
          result.filename ?? result.attachment.filename,
        ),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    logger.error(
      { err, vault, id, attachmentId },
      "download_issue_attachment failed",
    );
    return respondWithError(err, { resourceKind: "issue" });
  }
}
