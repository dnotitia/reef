import { describe, expect, it } from "vitest";
import { createJiraAccountMappingArtifact } from "./accountMapping.js";
import { convertAdfToMarkdown } from "./adf.js";

const rawRef = {
  runId: "run-1",
  entryId: "entry-media",
  contentSha256: "a".repeat(64),
};

describe("ADF to Markdown", () => {
  it("preserves node/mark order and resolves mentions through the account resolver", () => {
    const result = convertAdfToMarkdown(
      {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "first " },
              {
                type: "text",
                text: "linked",
                marks: [
                  { type: "strong" },
                  { type: "link", attrs: { href: "https://example.test" } },
                ],
              },
              { type: "text", text: " then " },
              { type: "mention", attrs: { id: "acct-1", text: "@Alice" } },
              { type: "hardBreak" },
              { type: "emoji", attrs: { text: "✅" } },
            ],
          },
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { state: "DONE" },
                content: [{ type: "text", text: "ship" }],
              },
            ],
          },
        ],
      },
      {
        accountMapping: {
          artifact: createJiraAccountMappingArtifact({
            jiraCloudId: "cloud",
            overrides: { "acct-1": { actor: "reef-alice" } },
          }),
        },
      },
    );
    expect(result.markdown).toContain(
      "first [**linked**](https://example.test) then @reef\\-alice  \n✅",
    );
    expect(result.markdown).toContain("- [x] ship");
    expect(result.reports).toContainEqual(
      expect.objectContaining({
        nodeType: "mention",
        reason: "mention_actor:override",
      }),
    );
  });

  it("uses a non-identifying placeholder for an unmapped mention", () => {
    const result = convertAdfToMarkdown(
      {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "mention",
                attrs: {
                  id: "acct-private-123",
                  text: "@[Private](javascript:alert(1))\nUser",
                },
              },
            ],
          },
        ],
      },
      {
        accountMapping: {
          artifact: createJiraAccountMappingArtifact({ jiraCloudId: "cloud" }),
        },
      },
    );
    expect(result.markdown).toContain("@jira\\-user");
    expect(result.markdown).not.toContain("Private");
    expect(result.markdown).not.toContain("javascript:");
    expect(JSON.stringify(result)).not.toContain("acct-private-123");
    expect(result.reports).toContainEqual(
      expect.objectContaining({
        classification: "preserved",
        nodeType: "mention",
        reason: "mention_unmapped",
      }),
    );
  });

  it("escapes source-controlled emoji, expand, and media attributes", () => {
    const result = convertAdfToMarkdown(
      {
        type: "doc",
        version: 1,
        content: [
          {
            type: "emoji",
            attrs: { text: "[x](javascript:alert(1))" },
          },
          {
            type: "expand",
            attrs: { title: "[title](javascript:alert(2))\n# injected" },
          },
          {
            type: "mediaInline",
            attrs: { id: "]([media](javascript:alert(3))", type: "file" },
          },
        ],
      },
      {
        descriptionRawArchiveReference: rawRef,
        mediaRawArchiveReferences: {
          "]([media](javascript:alert(3))": rawRef,
        },
      },
    );
    expect(result.markdown).not.toContain("[x](javascript:");
    expect(result.markdown).not.toContain("[title](javascript:");
    expect(result.markdown).not.toContain("[media](javascript:");
    expect(result.markdown).toContain("\\[x\\]\\(javascript:alert\\(1\\)\\)");
    expect(result.markdown).toContain("# injected");
    expect(result.markdown).not.toContain("\n# injected");
  });

  it("keeps unsafe ADF links as plain text and reports the rejected mark", () => {
    const result = convertAdfToMarkdown(
      {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "unsafe",
                marks: [
                  { type: "link", attrs: { href: "javascript:alert(1)" } },
                ],
              },
            ],
          },
        ],
      },
      { descriptionRawArchiveReference: rawRef },
    );
    expect(result.markdown).toContain("unsafe");
    expect(result.markdown).not.toContain("javascript:");
    expect(result.reports).toContainEqual(
      expect.objectContaining({
        classification: "unsupported",
        path: "$.content[0].content[0].marks[0]",
        nodeType: "mark:link",
        reason: "link_href_unsafe",
        rawArchiveReference: rawRef,
      }),
    );
  });

  it("percent-encodes link-destination parentheses that could close Markdown", () => {
    const result = convertAdfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "safe label",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "https://example.test/) [x](javascript:alert(1))",
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.markdown).toContain("%29%20[x]%28javascript:alert%281%29%29");
    expect(result.markdown).not.toContain(") [x](javascript:");
  });

  it("uses a non-escapable code fence and sanitizes the info string", () => {
    const result = convertAdfToMarkdown(
      {
        type: "doc",
        version: 1,
        content: [
          {
            type: "codeBlock",
            attrs: { language: "ts\nunsafe" },
            content: [
              {
                type: "text",
                text: "before\n```\n[unsafe](javascript:alert(1))",
              },
            ],
          },
        ],
      },
      { descriptionRawArchiveReference: rawRef },
    );
    expect(result.markdown).toContain(
      "````\nbefore\n```\n[unsafe](javascript:alert(1))\n````",
    );
    expect(result.markdown).not.toContain("ts\nunsafe");
    expect(result.reports).toContainEqual(
      expect.objectContaining({
        classification: "preserved",
        path: "$.content[0]",
        nodeType: "codeBlock",
        reason: "code_language_sanitized",
        rawArchiveReference: rawRef,
      }),
    );
  });

  it("preserves hard-break markers and code-block trailing whitespace", () => {
    const result = convertAdfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "first" },
            { type: "hardBreak" },
            { type: "text", text: "second" },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "text" },
          content: [{ type: "text", text: "value \t \nnext\t" }],
        },
      ],
    });
    expect(result.markdown).toBe(
      "first  \nsecond\n\n```text\nvalue \t \nnext\t\n```",
    );
  });

  it("uses a longer inline-code delimiter without rewriting backslashes", () => {
    const source = "C:\\temp\\`tick`` [x](javascript:alert(1))";
    const result = convertAdfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: source, marks: [{ type: "code" }] }],
        },
      ],
    });
    expect(result.markdown).toBe(`\`\`\` ${source} \`\`\``);
  });

  it("removes large trailing tab runs in linear output order", () => {
    const result = convertAdfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: `kept${"\t".repeat(100_000)}` }],
        },
      ],
    });
    expect(result.markdown).toBe("kept");
  });

  it("rejects unsafe card URLs without preserving active Markdown", () => {
    const result = convertAdfToMarkdown(
      {
        type: "doc",
        version: 1,
        content: [
          {
            type: "blockCard",
            attrs: { url: "[click](javascript:alert(1))" },
          },
        ],
      },
      { descriptionRawArchiveReference: rawRef },
    );
    expect(result.markdown).toContain("[Unsupported Jira card URL]");
    expect(result.markdown).not.toContain("javascript:");
    expect(result.reports).toContainEqual(
      expect.objectContaining({
        classification: "unsupported",
        path: "$.content[0]",
        nodeType: "blockCard",
        reason: "card_url_unsafe",
        rawArchiveReference: rawRef,
      }),
    );
  });

  it("reports exact unsupported paths and emits stable media placeholders with opaque refs", () => {
    const adf = {
      type: "doc",
      content: [
        { type: "mystery", content: [{ type: "text", text: "kept" }] },
        {
          type: "mediaInline",
          attrs: { id: "media-1", type: "file", collection: "jira" },
        },
      ],
    };
    const first = convertAdfToMarkdown(adf, {
      descriptionRawArchiveReference: rawRef,
      mediaRawArchiveReferences: { "media-1": rawRef },
    });
    const second = convertAdfToMarkdown(adf, {
      descriptionRawArchiveReference: rawRef,
      mediaRawArchiveReferences: { "media-1": rawRef },
    });
    expect(first).toEqual(second);
    expect(first.reports).toContainEqual(
      expect.objectContaining({
        classification: "unsupported",
        path: "$.content[0]",
        nodeType: "mystery",
        reason: "description_node_unsupported",
      }),
    );
    expect(first.markdown).toContain(
      `\\[Jira media media\\-1 \\(file\\) raw:run\\-1/entry\\-media@${rawRef.contentSha256}\\]`,
    );
    expect(JSON.stringify(first)).not.toContain('"type":"doc"');
  });
});
