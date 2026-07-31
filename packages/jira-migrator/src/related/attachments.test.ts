import type { IssueAttachment } from "@reef/core";
import { describe, expect, it } from "vitest";
import type { NormalizedJiraAttachment } from "../payloads.js";
import {
  attachmentReadbackMismatches,
  resolveAttachmentMimeType,
  validAttachmentReadback,
} from "./attachments.js";

const source: NormalizedJiraAttachment = {
  id: "19464",
  contentUrl: "https://example.atlassian.net/attachment/19464",
  filename: "sample.png",
  mimeType: null,
  size: 3,
  created: "2026-05-21T05:07:18.436+0900",
  author: null,
};

const attachment = {
  id: "attachment-id",
  reef_id: "SAASV31-071",
  file_uri: "akb://reef-saasv31/issues/file/file-id",
  filename: "sample.png",
  mime_type: "image/png",
  size_bytes: 3,
  author: "actor",
  created_at: "2026-05-21T05:07:18.436+0900",
  source: "jira_import",
  inline: false,
  original_jira_attachment_id: "19464",
  meta: { source: "jira", jira_cloud_id: "cloud-id" },
} satisfies IssueAttachment;

const expected = {
  reefId: "SAASV31-071",
  author: "actor",
  createdAt: "2026-05-21T05:07:18.436+0900",
  mimeType: "image/png",
  jiraCloudId: "cloud-id",
  fileUri: "akb://reef-saasv31/issues/file/file-id",
};

describe("attachmentReadbackMismatches", () => {
  it("accepts an exact metadata and byte readback", () => {
    const readback = { attachment, bytes: new Uint8Array([1, 2, 3]) };
    expect(
      attachmentReadbackMismatches(readback, source, expected, readback.bytes),
    ).toEqual([]);
    expect(
      validAttachmentReadback(readback, source, expected, readback.bytes),
    ).toBe(true);
  });

  it("accepts canonically equivalent Unicode filenames", () => {
    const decomposedSource = {
      ...source,
      filename: "e\u0301vidence.png",
    };
    const normalizedReadback = {
      attachment: { ...attachment, filename: "évidence.png" },
      bytes: new Uint8Array([1, 2, 3]),
    };

    expect(
      attachmentReadbackMismatches(
        normalizedReadback,
        decomposedSource,
        expected,
        normalizedReadback.bytes,
      ),
    ).toEqual([]);
  });

  it("returns only safe field codes for mismatches", () => {
    expect(
      attachmentReadbackMismatches(
        {
          attachment: {
            ...attachment,
            filename: "server-name.png",
            mime_type: "application/octet-stream",
          },
          bytes: new Uint8Array([1, 2]),
        },
        source,
        expected,
        new Uint8Array([1, 2, 3]),
      ),
    ).toEqual(["filename", "mime_type", "stored_size", "source_size", "bytes"]);
  });
});

describe("resolveAttachmentMimeType", () => {
  it("rejects wildcard response headers and detects PNG bytes", () => {
    expect(
      resolveAttachmentMimeType(
        null,
        "*/*;charset=UTF-8",
        "capture.png",
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("image/png");
  });

  it("prefers a specific Jira MIME and falls back conservatively", () => {
    expect(
      resolveAttachmentMimeType(
        "IMAGE/JPEG; charset=binary",
        "application/octet-stream",
        "capture.bin",
        new Uint8Array(),
      ),
    ).toBe("image/jpeg");
    expect(
      resolveAttachmentMimeType(
        null,
        "not-a-mime",
        "unknown.bin",
        new Uint8Array(),
      ),
    ).toBe("application/octet-stream");
  });
});
