import { localizedErrorResponse } from "@/lib/api/errorLocalization";
import {
  getAkbAdapter,
  getAkbCurrentActor,
  invalidBodyResponse,
  invalidIssueIdResponse,
  isValidIssueIdPathParam,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import {
  IssueAttachmentSourceEnum,
  akbListIssueAttachments as listIssueAttachments,
  akbUploadIssueAttachment as uploadIssueAttachment,
} from "@reef/core";
import { z } from "zod";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const DEFAULT_ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/json",
  "application/zip",
  "text/csv",
  "text/markdown",
  "text/plain",
] as const;

const UploadFormSchema = z.object({
  source: IssueAttachmentSourceEnum.default("issue_body"),
  inline: z.boolean().default(false),
});

function attachmentMaxBytes(): number {
  const parsed = Number(process.env.REEF_ATTACHMENT_MAX_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BYTES;
}

function attachmentMaxRequestBytes(maxFileBytes: number): number {
  return maxFileBytes + MULTIPART_OVERHEAD_BYTES;
}

function parseContentLength(request: Request): number | null {
  const raw = request.headers.get("content-length");
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function boundedFormData(
  request: Request,
  maxRequestBytes: number,
): Promise<FormData | "invalid" | "too_large"> {
  const contentLength = parseContentLength(request);
  if (contentLength !== null && contentLength > maxRequestBytes) {
    return "too_large";
  }

  if (!request.body) return "invalid";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let readResult = await reader.read();
  while (!readResult.done) {
    const { value } = readResult;
    totalBytes += value.byteLength;
    if (totalBytes > maxRequestBytes) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(value);
    readResult = await reader.read();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return await new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
    }).formData();
  } catch {
    return "invalid";
  }
}

function allowedMimePatterns(): string[] {
  const configured = process.env.REEF_ATTACHMENT_ALLOWED_MIME_TYPES;
  if (!configured) return [...DEFAULT_ALLOWED_TYPES];
  return configured
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mimeAllowed(mimeType: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => {
    if (entry === "*/*") return true;
    if (entry.endsWith("/*")) {
      return mimeType.startsWith(entry.slice(0, -1));
    }
    return entry === mimeType;
  });
}

function markdownAlt(filename: string): string {
  return filename.replace(/[\[\]\\]/g, "\\$&");
}

/** GET /api/issues/[id]/attachments?vault={vault} -> { attachments } */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isValidIssueIdPathParam(id)) return invalidIssueIdResponse();

  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const attachments = await runRouteSpan({
      name: "route.list_issue_attachments",
      attributes: { vault, issue_id: id },
      run: () => listIssueAttachments(adapter, vault, id),
    });
    return Response.json({ attachments });
  } catch (err) {
    logger.error({ err, vault, id }, "list_issue_attachments failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}

/** POST multipart file -> { attachment, markdown } */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isValidIssueIdPathParam(id)) return invalidIssueIdResponse();

  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  const maxBytes = attachmentMaxBytes();
  const maxRequestBytes = attachmentMaxRequestBytes(maxBytes);
  const contentLength = parseContentLength(request);
  if (contentLength !== null && contentLength > maxRequestBytes) {
    return localizedErrorResponse("attachmentTooLarge", 413);
  }

  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const form = await boundedFormData(request, maxRequestBytes);
  if (form === "too_large") {
    return localizedErrorResponse("attachmentTooLarge", 413);
  }
  if (form === "invalid") {
    return localizedErrorResponse("invalidBody", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return localizedErrorResponse("invalidBody", 400);
  }

  const parsedForm = UploadFormSchema.safeParse({
    source: form.get("source") ?? undefined,
    inline: form.get("inline") === "true",
  });
  if (!parsedForm.success) return invalidBodyResponse(parsedForm.error);

  if (file.size > maxBytes) {
    return localizedErrorResponse("attachmentTooLarge", 413);
  }
  const mimeType = file.type || "application/octet-stream";
  if (!mimeAllowed(mimeType, allowedMimePatterns())) {
    return localizedErrorResponse("attachmentTypeBlocked", 415);
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const attachment = await runRouteSpan({
      name: "route.upload_issue_attachment",
      attributes: { vault, issue_id: id, size_bytes: file.size },
      run: () =>
        uploadIssueAttachment({
          adapter,
          vault,
          reefId: id,
          filename: file.name || "attachment",
          mimeType,
          bytes,
          author: actor,
          source: parsedForm.data.source,
          inline: parsedForm.data.inline,
        }),
    });
    const markdown = attachment.mime_type.startsWith("image/")
      ? `![${markdownAlt(attachment.filename)}](${attachment.file_uri})`
      : null;
    return Response.json({ attachment, markdown }, { status: 201 });
  } catch (err) {
    logger.error({ err, vault, id }, "upload_issue_attachment failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}
