import type { IssueAttachment } from "@reef/core";
import type { NormalizedJiraAttachment } from "../payloads.js";

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  csv: "text/csv",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  md: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain",
  webp: "image/webp",
  zip: "application/zip",
};

const normalizedSpecificMimeType = (
  value: string | null | undefined,
): string | null => {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase();
  if (
    !normalized ||
    normalized === "*/*" ||
    normalized === "application/octet-stream" ||
    !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(
      normalized,
    )
  )
    return null;
  return normalized;
};

const sniffMimeType = (bytes: Uint8Array): string | null => {
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    )
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  const prefix = new TextDecoder("ascii").decode(bytes.subarray(0, 12));
  if (prefix.startsWith("GIF87a") || prefix.startsWith("GIF89a"))
    return "image/gif";
  if (prefix.startsWith("%PDF-")) return "application/pdf";
  if (prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WEBP")
    return "image/webp";
  return null;
};

export const resolveAttachmentMimeType = (
  sourceMimeType: string | null | undefined,
  downloadMimeType: string | null | undefined,
  filename: string,
  bytes: Uint8Array,
): string => {
  const explicit = normalizedSpecificMimeType(sourceMimeType);
  if (explicit) return explicit;
  const downloaded = normalizedSpecificMimeType(downloadMimeType);
  if (downloaded) return downloaded;
  const sniffed = sniffMimeType(bytes);
  if (sniffed) return sniffed;
  const extension = /\.([^.]+)$/u.exec(filename)?.[1]?.toLowerCase();
  return (
    (extension && MIME_BY_EXTENSION[extension]) ?? "application/octet-stream"
  );
};

export type AttachmentReadbackMismatch =
  | "missing"
  | "file_uri"
  | "original_jira_attachment_id"
  | "reef_id"
  | "filename"
  | "mime_type"
  | "author"
  | "created_at"
  | "source"
  | "meta_source"
  | "meta_jira_cloud_id"
  | "stored_size"
  | "source_size"
  | "bytes";

export const attachmentReadbackMismatches = (
  readback: {
    attachment: IssueAttachment;
    bytes: Uint8Array;
  } | null,
  source: NormalizedJiraAttachment,
  expected: {
    reefId: string;
    author: string;
    createdAt: string;
    mimeType: string;
    jiraCloudId: string;
    fileUri: string;
  },
  expectedBytes?: Uint8Array,
): AttachmentReadbackMismatch[] => {
  if (readback === null) return ["missing"];
  const mismatches: AttachmentReadbackMismatch[] = [];
  const { attachment, bytes } = readback;
  if (attachment.file_uri !== expected.fileUri) mismatches.push("file_uri");
  if (attachment.original_jira_attachment_id !== source.id)
    mismatches.push("original_jira_attachment_id");
  if (attachment.reef_id !== expected.reefId) mismatches.push("reef_id");
  if (attachment.filename.normalize("NFC") !== source.filename.normalize("NFC"))
    mismatches.push("filename");
  if (attachment.mime_type !== expected.mimeType) mismatches.push("mime_type");
  if (attachment.author !== expected.author) mismatches.push("author");
  if (attachment.created_at !== expected.createdAt)
    mismatches.push("created_at");
  if (attachment.source !== "jira_import") mismatches.push("source");
  if (attachment.meta?.source !== "jira") mismatches.push("meta_source");
  if (attachment.meta?.jira_cloud_id !== expected.jiraCloudId)
    mismatches.push("meta_jira_cloud_id");
  if (attachment.size_bytes !== bytes.byteLength)
    mismatches.push("stored_size");
  if (source.size !== null && bytes.byteLength !== source.size)
    mismatches.push("source_size");
  if (
    expectedBytes !== undefined &&
    (bytes.byteLength !== expectedBytes.byteLength ||
      !bytes.every((byte, index) => byte === expectedBytes[index]))
  )
    mismatches.push("bytes");
  return mismatches;
};

export const validAttachmentReadback = (
  ...args: Parameters<typeof attachmentReadbackMismatches>
): boolean => attachmentReadbackMismatches(...args).length === 0;
