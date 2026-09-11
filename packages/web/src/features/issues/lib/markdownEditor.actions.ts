"use client";

import {
  uploadMarkdownBatch,
  type MarkdownAdapterError,
  type MarkdownAsset,
  type MarkdownTargetKind,
  type MarkdownTargetResolution,
  type MarkdownTargetResolver,
  type MarkdownTargetResolverContext,
  type MarkdownUploadAdapter,
  type MarkdownUploadBatchResult,
  type MarkdownUploadContext,
} from "@akb/markdown-editor";
import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  buildAkbDocumentUrl,
  parseAkbDocumentUri,
} from "@/lib/akb/documentUri";
import type {
  AkbDocumentAssetMetadata,
  AkbDocumentAssetUploadResponse,
} from "@reef/core";
import type { AttachmentUploadResult } from "../hooks/mutations/useUploadIssueAttachment";
import { isAkbFileUri, resolveIssueAttachmentUrl } from "./attachmentUrls";

const IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ASSET_TARGET_RE =
  /^\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/iu;

type MarkdownUnavailableReason = Extract<
  MarkdownTargetResolution,
  { status: "unavailable" }
>["reason"];

export interface IssueMarkdownUploadAdapterOptions {
  issueId: string;
  vault: string;
  uploadLegacyAttachment: (file: File) => Promise<AttachmentUploadResult>;
}

export interface IssueMarkdownTargetResolverOptions {
  issueId: string;
  vault: string;
  akbWebBase?: string | null;
}

function fileName(file: Blob): string {
  return typeof File !== "undefined" && file instanceof File && file.name
    ? file.name
    : "attachment";
}

function namedFile(file: Blob): File {
  if (typeof File !== "undefined" && file instanceof File) return file;
  return new File([file], fileName(file), { type: file.type });
}

function adapterError(
  code: MarkdownAdapterError["code"],
  message: string,
  retryable = false,
): MarkdownAdapterError {
  return { code, message, retryable };
}

function invalidUploadContext(message: string): Error & MarkdownAdapterError {
  return Object.assign(new Error(message), adapterError("invalid", message));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDocumentAssetUploadResponse(
  value: unknown,
): value is AkbDocumentAssetUploadResponse {
  const target =
    isRecord(value) && typeof value.target === "string" ? value.target : "";
  const id = isRecord(value) && typeof value.id === "string" ? value.id : "";
  const targetMatch = ASSET_TARGET_RE.exec(target);
  return (
    isRecord(value) &&
    value.kind === "attachment" &&
    targetMatch?.[1]?.toLowerCase() === id.toLowerCase() &&
    typeof value.name === "string" &&
    typeof value.mime_type === "string" &&
    typeof value.size_bytes === "number"
  );
}

function isDocumentAssetMetadata(
  value: unknown,
): value is AkbDocumentAssetMetadata {
  return (
    isRecord(value) &&
    value.kind === "attachment" &&
    typeof value.target === "string" &&
    (value.status === "unclaimed" ||
      value.status === "claimed" ||
      value.status === "expired")
  );
}

function assetRuntimeUrl(
  id: string,
  context: MarkdownTargetResolverContext,
): string {
  const query = new URLSearchParams();
  if (context.vault) query.set("vault", context.vault);
  if (context.document) query.set("document", context.document);
  if (context.commit) query.set("commit", context.commit);
  const queryString = query.toString();
  return `/api/assets/${id}${queryString ? `?${queryString}` : ""}`;
}

function unavailable(
  target: string,
  kind: MarkdownTargetKind | undefined,
  reason: MarkdownUnavailableReason,
): MarkdownTargetResolution {
  return { target, kind, status: "unavailable", reason };
}

async function uploadDocumentAsset(
  file: File,
  context: MarkdownUploadContext,
): Promise<MarkdownAsset> {
  if (!context.vault) {
    throw invalidUploadContext("A vault is required for image uploads.");
  }
  if (!IMAGE_MIME_TYPES.has(file.type)) {
    throw invalidUploadContext("This image type is not supported.");
  }

  const query = new URLSearchParams({
    vault: context.vault,
    filename: file.name || "attachment",
  });
  const response = await apiFetch(`/api/assets?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
    signal: context.signal,
  });
  if (!response.ok) {
    await throwHttpError(response, `Image upload failed: ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (!isDocumentAssetUploadResponse(payload)) {
    throw invalidUploadContext("The image upload response was invalid.");
  }
  return {
    id: payload.id,
    kind: "attachment",
    target: payload.target,
    alt: payload.name,
    expiresAt: payload.unclaimed_expires_at ?? undefined,
  };
}

function createIssueMarkdownUploadAdapter(
  options: IssueMarkdownUploadAdapterOptions,
): MarkdownUploadAdapter {
  return {
    async upload(file, context) {
      const named = namedFile(file);
      if (IMAGE_MIME_TYPES.has(named.type)) {
        return uploadDocumentAsset(named, {
          ...context,
          vault: context?.vault ?? options.vault,
          draftId: context?.draftId ?? options.issueId,
        });
      }

      const result = await options.uploadLegacyAttachment(named);
      return {
        id: result.attachment.id,
        kind: "file",
        target: result.attachment.file_uri,
        alt: result.attachment.filename,
      };
    },
  };
}

export function uploadIssueMarkdownFiles(
  options: IssueMarkdownUploadAdapterOptions & {
    files: readonly File[];
    signal?: AbortSignal;
  },
): Promise<MarkdownUploadBatchResult> {
  const adapter = createIssueMarkdownUploadAdapter(options);
  return uploadMarkdownBatch(adapter, options.files, {
    vault: options.vault,
    draftId: options.issueId,
    signal: options.signal,
  });
}

function akbVault(target: string): string | undefined {
  return target.match(/^akb:\/\/([^/]+)\//u)?.[1];
}

function resolverVault(
  options: IssueMarkdownTargetResolverOptions,
  context: MarkdownTargetResolverContext,
): string | undefined {
  return context.vault ?? options.vault;
}

async function resolveAssetTarget(
  target: string,
  assetId: string,
  options: IssueMarkdownTargetResolverOptions,
  context: MarkdownTargetResolverContext,
): Promise<MarkdownTargetResolution> {
  const vault = resolverVault(options, context);
  if (!vault) return unavailable(target, "attachment", "unknown");

  const query = new URLSearchParams({ vault });
  if (context.document) query.set("document", context.document);
  if (context.commit) query.set("commit", context.commit);
  const response = await apiFetch(
    `/api/assets/${assetId}/metadata?${query.toString()}`,
    { signal: context.signal },
  );
  if (!response.ok) {
    return unavailable(
      target,
      "attachment",
      response.status === 404 ? "inaccessible" : "unknown",
    );
  }
  const payload: unknown = await response.json();
  if (!isDocumentAssetMetadata(payload)) {
    return unavailable(target, "attachment", "unknown");
  }
  if (payload.status === "expired") {
    return unavailable(target, "attachment", "expired");
  }
  return {
    target,
    kind: "attachment",
    status: "available",
    runtimeUrl: assetRuntimeUrl(assetId, { ...context, vault }),
  };
}

export function createIssueMarkdownTargetResolver(
  options: IssueMarkdownTargetResolverOptions,
): MarkdownTargetResolver {
  return {
    async resolve(target, context = {}) {
      const assetMatch = ASSET_TARGET_RE.exec(target);
      if (assetMatch?.[1]) {
        return resolveAssetTarget(target, assetMatch[1], options, context);
      }

      const document = parseAkbDocumentUri(target);
      const targetVault = akbVault(target);
      const vault = resolverVault(options, context);
      if (document) {
        if (vault && document.vault !== vault) {
          return unavailable(target, "document", "cross-vault");
        }
        return {
          target,
          kind: "document",
          status: "available",
          runtimeUrl: buildAkbDocumentUrl(options.akbWebBase, target) ?? target,
        };
      }

      if (isAkbFileUri(target)) {
        if (vault && targetVault && targetVault !== vault) {
          return unavailable(target, "file", "cross-vault");
        }
        return {
          target,
          kind: "file",
          status: "available",
          runtimeUrl: resolveIssueAttachmentUrl({
            issueId: options.issueId,
            vault: vault ?? options.vault,
            url: target,
            key: "href",
          }),
        };
      }

      return unavailable(target, undefined, "unsupported");
    },
  };
}
