import { z } from "zod";
import { SchemaValidationError } from "../../../errors";
import type { AkbAdapter, AkbBinaryResponse } from "../core/http";
import { withSpan } from "../core/tracing";

const ASSET_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const DocumentAssetUploadResponseSchema = z.looseObject({
  kind: z.literal("attachment"),
  id: z.string().min(1),
  target: z.string().min(1),
  url: z.string().min(1).optional(),
  name: z.string().min(1),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  unclaimed_expires_at: z.string().nullable().optional(),
  source_file_uri: z.string().min(1).optional(),
});

const DocumentAssetMetadataSchema = z.looseObject({
  kind: z.literal("attachment"),
  target: z.string().min(1),
  status: z.enum(["unclaimed", "claimed", "expired"]),
  unclaimed_expires_at: z.string().nullable().optional(),
});

const DocumentAssetPolicySchema = z.looseObject({
  kind: z.literal("attachment_policy"),
  vault: z.string().min(1),
  server_time: z.string().min(1),
  unclaimed_ttl_hours: z.number().int().positive(),
  revision_retention_days: z.number().int().positive(),
});

export type DocumentAssetUploadResponse = z.infer<
  typeof DocumentAssetUploadResponseSchema
>;
export type DocumentAssetMetadata = z.infer<typeof DocumentAssetMetadataSchema>;
export type DocumentAssetPolicy = z.infer<typeof DocumentAssetPolicySchema>;

export interface UploadDocumentAssetParams {
  adapter: AkbAdapter;
  vault: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ReadDocumentAssetParams {
  adapter: AkbAdapter;
  vault: string;
  assetId: string;
  document?: string;
  commit?: string;
}

function encode(value: string): string {
  return encodeURIComponent(value);
}

function assetPath(assetId: string): string {
  if (!ASSET_ID_RE.test(assetId)) {
    throw new SchemaValidationError({ issues: ["invalid document asset id"] });
  }
  return encode(assetId);
}

function bytesAsArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function parseBinaryResponse(value: unknown): AkbBinaryResponse {
  if (!value || typeof value !== "object") {
    throw new SchemaValidationError({
      issues: ["document asset response is not a binary envelope"],
    });
  }
  const candidate = value as {
    body?: unknown;
    contentType?: unknown;
    contentLength?: unknown;
    filename?: unknown;
  };
  if (!(candidate.body instanceof ArrayBuffer)) {
    throw new SchemaValidationError({
      issues: ["document asset response body is not an ArrayBuffer"],
    });
  }
  return {
    body: candidate.body,
    contentType:
      typeof candidate.contentType === "string" ? candidate.contentType : null,
    contentLength:
      typeof candidate.contentLength === "number"
        ? candidate.contentLength
        : null,
    filename:
      typeof candidate.filename === "string" ? candidate.filename : null,
  };
}

/** Upload an authenticated, unclaimed Document Attachment image. */
export async function uploadDocumentAsset(
  params: UploadDocumentAssetParams,
): Promise<DocumentAssetUploadResponse> {
  return withSpan(
    "akb.upload_document_asset",
    { vault: params.vault },
    async (span) => {
      const result = DocumentAssetUploadResponseSchema.parse(
        await params.adapter.request(`/api/v1/assets/${encode(params.vault)}`, {
          method: "POST",
          rawBody: bytesAsArrayBuffer(params.bytes),
          rawHeaders: { "Content-Type": params.mimeType },
          query: { filename: params.filename },
          resource: `document asset ${params.filename}`,
        }),
      );
      span.setAttribute("asset.size_bytes", result.size_bytes);
      return result;
    },
  );
}

/** Read stable Document Attachment bytes through AKB's authenticated route. */
export async function readDocumentAsset(
  params: ReadDocumentAssetParams,
): Promise<AkbBinaryResponse> {
  return withSpan(
    "akb.read_document_asset",
    { vault: params.vault, asset_id: params.assetId },
    async () =>
      parseBinaryResponse(
        await params.adapter.request(
          `/api/assets/${assetPath(params.assetId)}`,
          {
            query: {
              vault: params.vault,
              document: params.document,
              commit: params.commit,
            },
            responseType: "arrayBuffer",
            resource: `document asset ${params.assetId}`,
          },
        ),
      ),
  );
}

/** Read lifecycle metadata using the same authorized reachability predicate. */
export async function getDocumentAssetMetadata(
  params: ReadDocumentAssetParams,
): Promise<DocumentAssetMetadata> {
  return withSpan(
    "akb.get_document_asset_metadata",
    { vault: params.vault, asset_id: params.assetId },
    async () =>
      DocumentAssetMetadataSchema.parse(
        await params.adapter.request(
          `/api/v1/assets/${encode(params.vault)}/${assetPath(params.assetId)}/metadata`,
          {
            query: { document: params.document, commit: params.commit },
            resource: `document asset ${params.assetId}`,
          },
        ),
      ),
  );
}

/** Discard an uploader-owned unclaimed asset. */
export async function discardDocumentAsset(
  adapter: AkbAdapter,
  vault: string,
  assetId: string,
): Promise<{ discarded: boolean }> {
  return withSpan(
    "akb.discard_document_asset",
    { vault, asset_id: assetId },
    async () => {
      const result = await adapter.request(
        `/api/v1/assets/${encode(vault)}/${assetPath(assetId)}`,
        {
          method: "DELETE",
          resource: `document asset ${assetId}`,
        },
      );
      const discarded =
        result !== null &&
        typeof result === "object" &&
        "discarded" in result &&
        (result as { discarded?: unknown }).discarded === true;
      return { discarded };
    },
  );
}

/** Copy an existing standalone AKB File into a new immutable Attachment. */
export async function copyFileToDocumentAsset(
  adapter: AkbAdapter,
  vault: string,
  fileId: string,
): Promise<DocumentAssetUploadResponse> {
  return withSpan(
    "akb.copy_file_to_document_asset",
    { vault, file_id: fileId },
    async () =>
      DocumentAssetUploadResponseSchema.parse(
        await adapter.request(
          `/api/v1/assets/${encode(vault)}/from-file/${encode(fileId)}`,
          {
            method: "POST",
            resource: `document asset from file ${fileId}`,
          },
        ),
      ),
  );
}

/** Read the active server retention policy for recovered drafts. */
export async function getDocumentAssetPolicy(
  adapter: AkbAdapter,
  vault: string,
): Promise<DocumentAssetPolicy> {
  return withSpan("akb.get_document_asset_policy", { vault }, async () =>
    DocumentAssetPolicySchema.parse(
      await adapter.request(`/api/v1/assets/${encode(vault)}/policy`, {
        resource: `document asset policy ${vault}`,
      }),
    ),
  );
}
