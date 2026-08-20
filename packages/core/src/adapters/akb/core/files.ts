import { z } from "zod";
import { AkbApiError, SchemaValidationError } from "../../../errors";
import type { AkbAdapter } from "./http";

const AkbFileUploadInitResponseSchema = z.looseObject({
  uri: z.string().min(1),
  upload_url: z.url(),
});

const AkbFileResponseSchema = z.looseObject({
  uri: z.string().min(1),
  name: z.string().min(1),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
});

const AkbFileDownloadResponseSchema = z.looseObject({
  name: z.string().min(1),
  download_url: z.url(),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
});

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

async function sha256(bytes: Uint8Array): Promise<string> {
  const copied = new Uint8Array(bytes.byteLength);
  copied.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copied);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

async function fetchPresigned(
  url: string,
  init?: RequestInit,
  requestHeaders?: Record<string, string>,
): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SchemaValidationError({
      issues: ["AKB returned an unsupported presigned URL protocol"],
    });
  }
  const response = await fetch(parsed.href, {
    ...init,
    headers: {
      ...requestHeaders,
      ...init?.headers,
    },
    redirect: "error",
  });
  if (!response.ok) {
    throw new AkbApiError({
      status: response.status,
      message: `Presigned file transfer failed with HTTP ${response.status}`,
    });
  }
  return response;
}

export async function uploadAkbFile(
  params: UploadAkbFileParams,
): Promise<UploadAkbFileResult> {
  const { adapter, vault, filename, mimeType, bytes, collection, description } =
    params;
  const contentHash = await sha256(bytes);
  const initiated = AkbFileUploadInitResponseSchema.parse(
    await adapter.request(`/api/v1/files/${encodeURIComponent(vault)}/upload`, {
      method: "POST",
      query: {
        filename,
        collection,
        description,
        mime_type: mimeType,
        content_hash: contentHash,
      },
      resource: `file ${filename}`,
    }),
  );
  const fileId = fileIdFromUri(initiated.uri);
  const bodyBytes = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(bodyBytes).set(bytes);
  try {
    await fetchPresigned(
      initiated.upload_url,
      {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: bodyBytes,
      },
      adapter.requestHeaders,
    );
    const confirmed = AkbFileResponseSchema.parse(
      await adapter.request(
        `/api/v1/files/${encodeURIComponent(vault)}/${encodeURIComponent(
          fileId,
        )}/confirm`,
        {
          method: "POST",
          query: {
            content_hash: contentHash,
            hash_algorithm: "sha256",
          },
          resource: `file ${filename}`,
        },
      ),
    );
    return {
      uri: confirmed.uri,
      filename: confirmed.name,
      mimeType: confirmed.mime_type,
      sizeBytes: confirmed.size_bytes,
    };
  } catch (error) {
    await adapter
      .request(
        `/api/v1/files/${encodeURIComponent(vault)}/${encodeURIComponent(
          fileId,
        )}`,
        {
          method: "DELETE",
          resource: `file ${filename}`,
        },
      )
      .catch(() => undefined);
    throw error;
  }
}

export async function downloadAkbFile(
  adapter: AkbAdapter,
  vault: string,
  uri: string,
): Promise<DownloadAkbFileResult> {
  const fileId = fileIdFromUri(uri);
  const metadata = AkbFileDownloadResponseSchema.parse(
    await adapter.request(
      `/api/v1/files/${encodeURIComponent(vault)}/${encodeURIComponent(
        fileId,
      )}/download`,
      { resource: `file ${fileId}` },
    ),
  );
  const response = await fetchPresigned(
    metadata.download_url,
    { headers: { Accept: "*/*" } },
    adapter.requestHeaders,
  );
  const body = await response.arrayBuffer();
  return {
    body,
    contentType: metadata.mime_type,
    filename: metadata.name,
    sizeBytes: metadata.size_bytes,
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
