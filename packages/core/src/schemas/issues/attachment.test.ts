import { describe, expect, it } from "vitest";
import {
  IssueAttachmentCreateInputSchema,
  IssueAttachmentSchema,
  IssueAttachmentSourceEnum,
} from "./attachment";

describe("IssueAttachmentSchema (REEF-349)", () => {
  it("parses issue-scoped AKB file metadata", () => {
    const attachment = IssueAttachmentSchema.parse({
      id: "att-1",
      reef_id: "REEF-349",
      file_uri: "akb://reef-test/issues/file/file-1",
      filename: "screenshot.png",
      mime_type: "image/png",
      size_bytes: 1234,
      author: "alice",
      created_at: "2026-07-09T01:00:00.000Z",
      source: "issue_body",
      inline: true,
      original_jira_attachment_id: null,
      meta: null,
    });

    expect(attachment.file_uri).toBe("akb://reef-test/issues/file/file-1");
    expect(attachment.inline).toBe(true);
  });

  it("recognizes all user/import attachment sources", () => {
    expect(IssueAttachmentSourceEnum.options).toEqual([
      "issue_body",
      "comment",
      "jira_import",
    ]);
  });

  it("rejects negative byte sizes and invalid sources", () => {
    expect(
      IssueAttachmentCreateInputSchema.safeParse({
        reef_id: "REEF-349",
        file_uri: "akb://reef-test/issues/file/file-1",
        filename: "broken.bin",
        mime_type: "application/octet-stream",
        size_bytes: -1,
        author: "alice",
        created_at: "2026-07-09T01:00:00.000Z",
        source: "issue_body",
      }).success,
    ).toBe(false);

    expect(
      IssueAttachmentCreateInputSchema.safeParse({
        reef_id: "REEF-349",
        file_uri: "akb://reef-test/issues/file/file-1",
        filename: "broken.bin",
        mime_type: "application/octet-stream",
        size_bytes: 1,
        author: "alice",
        created_at: "2026-07-09T01:00:00.000Z",
        source: "email",
      }).success,
    ).toBe(false);
  });
});
