import { z } from "zod";
import { SchemaValidationError } from "../../../errors";
import type { AkbAdapter, AkbBinaryResponse } from "./http";

const AkbFileUploadResponseSchema = z
  .object({
    uri: z.string().min(1),
    name: z.string().optional(),
    filename: z.string().optional(),
    mime_type: z.string().optional(),
    content_type: z.string().optional(),
    size_bytes: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export interface UploadAkbFileParams {
  adapter: AkbAdapter;
  vault: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  collection?: string;
  description?: string;
}

export interface UploadAkbFileResult {
  uri: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface DownloadAkbFileResult {
  body: ArrayBuffer;
  contentType: string;
  filename: string | null;
  sizeBytes: number | null;
}

function fileIdFromUri(uri: string): string {
  const match = uri.match(/\/file\/([^/]+)$/);
  if (!match?.[1]) {
    throw new SchemaValidationError({
      issues: [`invalid akb file uri: ${uri}`],
    });
  }
  return match[1];
}

export async function uploadAkbFile(
  params: UploadAkbFileParams,
): Promise<UploadAkbFileResult> {
  const { adapter, vault, filename, mimeType, bytes, collection, description } =
    params;
  const bodyBytes = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(bodyBytes).set(bytes);
  const form = new FormData();
  form.set("vault", vault);
  if (collection) form.set("collection", collection);
  if (description) form.set("description", description);
  form.set("file", new Blob([bodyBytes], { type: mimeType }), filename);

  const payload = await adapter.request("/api/v1/files", {
    method: "POST",
    rawBody: form,
    resource: `file ${filename}`,
  });
  const parsed = AkbFileUploadResponseSchema.parse(payload);
  return {
    uri: parsed.uri,
    filename: parsed.filename ?? parsed.name ?? filename,
    mimeType: parsed.mime_type ?? parsed.content_type ?? mimeType,
    sizeBytes: parsed.size_bytes ?? bytes.byteLength,
  };
}

export async function downloadAkbFile(
  adapter: AkbAdapter,
  vault: string,
  uri: string,
): Promise<DownloadAkbFileResult> {
  const fileId = fileIdFromUri(uri);
  const payload = (await adapter.request(
    `/api/v1/files/${encodeURIComponent(vault)}/${encodeURIComponent(fileId)}`,
    {
      rawHeaders: { Accept: "*/*" },
      resource: `file ${fileId}`,
      responseType: "arrayBuffer",
    },
  )) as AkbBinaryResponse;
  return {
    body: payload.body,
    contentType: payload.contentType ?? "application/octet-stream",
    filename: payload.filename,
    sizeBytes: payload.contentLength,
  };
}

export async function deleteAkbFile(
  adapter: AkbAdapter,
  vault: string,
  uri: string,
): Promise<void> {
  const fileId = fileIdFromUri(uri);
  await adapter.request(
    `/api/v1/files/${encodeURIComponent(vault)}/${encodeURIComponent(fileId)}`,
    {
      method: "DELETE",
      resource: `file ${fileId}`,
    },
  );
}
