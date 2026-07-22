import type { IssueAttachment } from "@reef/core";
import type { NormalizedJiraAttachment } from "../payloads.js";

export const validAttachmentReadback = (
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
): boolean =>
  readback !== null &&
  readback.attachment.file_uri === expected.fileUri &&
  readback.attachment.original_jira_attachment_id === source.id &&
  readback.attachment.reef_id === expected.reefId &&
  readback.attachment.filename === source.filename &&
  readback.attachment.mime_type === expected.mimeType &&
  readback.attachment.author === expected.author &&
  readback.attachment.created_at === expected.createdAt &&
  readback.attachment.source === "jira_import" &&
  readback.attachment.meta?.source === "jira" &&
  readback.attachment.meta?.jira_cloud_id === expected.jiraCloudId &&
  readback.attachment.size_bytes === readback.bytes.byteLength &&
  (source.size === null || readback.bytes.byteLength === source.size) &&
  (expectedBytes === undefined ||
    (readback.bytes.byteLength === expectedBytes.byteLength &&
      readback.bytes.every((byte, index) => byte === expectedBytes[index])));
