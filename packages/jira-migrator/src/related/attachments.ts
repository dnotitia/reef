import type { IssueAttachment } from "@reef/core";
import type { NormalizedJiraAttachment } from "../payloads.js";

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
  if (attachment.filename !== source.filename) mismatches.push("filename");
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
