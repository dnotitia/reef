import { describe, expect, it } from "vitest";
import {
  buildJiraAttachmentCreateInput,
  jiraAttachmentIdFromUrl,
  rewriteJiraAttachmentReferences,
} from "./jiraAttachments";

describe("Jira attachment import helpers (REEF-349)", () => {
  it("builds a reef_attachments create input that preserves the Jira id", () => {
    const input = buildJiraAttachmentCreateInput({
      reefId: "REEF-349",
      fileUri: "akb://reef-test/issues/file/file-1",
      filename: "diagram.png",
      mimeType: "image/png",
      sizeBytes: 2048,
      author: "jira-import",
      createdAt: "2026-07-09T01:00:00.000Z",
      jiraAttachmentId: "10001",
      inline: true,
      meta: {
        source_url:
          "https://acme.atlassian.net/rest/api/3/attachment/content/10001",
      },
    });

    expect(input).toMatchObject({
      reef_id: "REEF-349",
      source: "jira_import",
      inline: true,
      original_jira_attachment_id: "10001",
    });
  });

  it("extracts Jira attachment ids from REST and secure attachment URLs", () => {
    expect(
      jiraAttachmentIdFromUrl(
        "https://acme.atlassian.net/rest/api/3/attachment/content/10001",
      ),
    ).toBe("10001");
    expect(
      jiraAttachmentIdFromUrl(
        "https://acme.atlassian.net/secure/attachment/10002/screen.png",
      ),
    ).toBe("10002");
  });

  it("rewrites markdown and explicit Jira attachment tokens to AKB file URIs", () => {
    const markdown = [
      "![screen](https://acme.atlassian.net/secure/attachment/10001/screen.png)",
      "[download](https://acme.atlassian.net/rest/api/3/attachment/content/10002)",
      '[named download](https://acme.atlassian.net/rest/api/3/attachment/content/10002 "Jira file")',
      "legacy token jira-attachment://10001",
    ].join("\n");

    expect(
      rewriteJiraAttachmentReferences(markdown, [
        {
          original_jira_attachment_id: "10001",
          file_uri: "akb://reef-test/issues/file/file-1",
        },
        {
          original_jira_attachment_id: "10002",
          file_uri: "akb://reef-test/issues/file/file-2",
        },
      ]),
    ).toBe(
      [
        "![screen](akb://reef-test/issues/file/file-1)",
        "[download](akb://reef-test/issues/file/file-2)",
        '[named download](akb://reef-test/issues/file/file-2 "Jira file")',
        "legacy token akb://reef-test/issues/file/file-1",
      ].join("\n"),
    );
  });

  it("leaves unrelated links untouched", () => {
    const markdown = "[spec](https://example.com/spec)";
    expect(
      rewriteJiraAttachmentReferences(markdown, [
        {
          original_jira_attachment_id: "10001",
          file_uri: "akb://reef-test/issues/file/file-1",
        },
      ]),
    ).toBe(markdown);
  });

  it("scans adversarial markdown-like input without regex backtracking", () => {
    const noisyPrefix = `](! "`.repeat(5000);
    const markdown = `${noisyPrefix}\n[download](https://acme.atlassian.net/rest/api/3/attachment/content/10001)`;

    const rewritten = rewriteJiraAttachmentReferences(markdown, [
      {
        original_jira_attachment_id: "10001",
        file_uri: "akb://reef-test/issues/file/file-1",
      },
    ]);

    expect(rewritten).toContain(
      "[download](akb://reef-test/issues/file/file-1)",
    );
    expect(rewritten.startsWith(noisyPrefix)).toBe(true);
  });
});
