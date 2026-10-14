import {
  canonicalizeMarkdown,
  extractMarkdownReferences,
  extractMarkdownTargets,
  parseMarkdown,
  serializeMarkdown,
} from "@akb/markdown-editor";
import {
  MarkdownLocaleProvider,
  MarkdownToolbar,
} from "@akb/markdown-editor/react";
import {
  buildResolvedMentionRecipients,
  formatMentionToken,
  parseMentionTokens,
  IssueListItemSchema,
} from "@reef/core";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { MarkdownEditor } from "./MarkdownEditorImpl";

describe("Markdown editor public contract", () => {
  it("preserves the preserve profile constructs through canonical serialization", () => {
    const markdown = [
      'A raw <Callout tone="warning">note</Callout> block.',
      "",
      "```mermaid",
      "graph TD; A-->B",
      "```",
      "",
      "$$",
      "x^2",
      "$$",
    ].join("\n");

    const parsed = parseMarkdown(markdown, { profile: "preserve" });
    const serialized = serializeMarkdown(parsed, { profile: "preserve" });

    expect(serialized).toContain('<Callout tone="warning">note</Callout>');
    expect(serialized).toContain("```mermaid\ngraph TD; A-->B\n```");
    expect(serialized).toContain("$$\nx^2\n$$");
  });

  it("round-trips GFM table, task state, and AKB Markdown targets", () => {
    const markdown = [
      "| Name | State |",
      "| --- | --- |",
      "| Reef | ready |",
      "",
      "- [x] shipped",
      "- [ ] pending",
      "",
      "[Spec](akb://reef-test/coll/docs/doc/spec.md)",
      "",
      "![Diagram](/api/assets/123e4567-e89b-12d3-a456-426614174000)",
    ].join("\n");

    const canonical = canonicalizeMarkdown(markdown, { profile: "preserve" });

    expect(canonical).toContain("| Name | State |");
    expect(canonical).toContain("- [x] shipped");
    expect(canonical).toContain("- [ ] pending");
    expect(canonical).toContain(
      "[Spec](akb://reef-test/coll/docs/doc/spec.md)",
    );
    expect(canonical).toContain(
      "![Diagram](/api/assets/123e4567-e89b-12d3-a456-426614174000)",
    );
  });

  it("extracts only person, issue, and resource identities outside code and link labels", () => {
    const markdown = [
      "@alice is working on REEF-123.",
      "[@bob](https://example.test/@bob)",
      "`@carol` and `REEF-456` are code.",
      "",
      "[Spec](akb://reef-test/coll/docs/doc/spec.md)",
      "![Diagram](/api/assets/123e4567-e89b-12d3-a456-426614174000)",
    ].join("\n");

    expect(extractMarkdownReferences(markdown)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "person", value: "@alice" }),
        expect.objectContaining({ kind: "issue", value: "REEF-123" }),
      ]),
    );
    expect(extractMarkdownReferences(markdown)).toHaveLength(2);
    expect(extractMarkdownTargets(markdown)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "akb://reef-test/coll/docs/doc/spec.md",
        }),
        expect.objectContaining({
          target: "/api/assets/123e4567-e89b-12d3-a456-426614174000",
        }),
      ]),
    );
  });

  it.each([
    {
      markdown: String.raw`Before @{team@ops\\blue\}} after.`,
      members: [
        {
          username: "team@ops\\blue}",
          display_name: "Operations owner",
          role: "member",
        },
      ],
      references: [
        {
          id: "team@ops\\blue}",
          value: String.raw`@{team@ops\\blue\}}`,
          title: "@team@ops\\blue}",
        },
      ],
    },
    {
      markdown: "@alice @Alice REEF-001",
      members: [
        { username: "alice", display_name: "Alice Lower", role: "member" },
        { username: "Alice", display_name: "Alice Upper", role: "member" },
      ],
      references: [
        { id: "alice", value: "@alice", title: "@alice" },
        { id: "Alice", value: "@Alice", title: "@Alice" },
      ],
    },
  ])(
    "keeps exact username identities separate from authored mention tokens in $markdown",
    async ({ markdown, members, references }) => {
      const onChange = vi.fn();
      const mentionConfig = {
        members,
        issues: [
          IssueListItemSchema.parse({
            id: "REEF-001",
            title: "Auth flow",
            status: "todo",
            created_at: "2026-01-01T00:00:00.000Z",
            created_by: "alice",
            updated_at: "2026-01-01T00:00:00.000Z",
            updated_by: "alice",
            archived_at: null,
          }),
        ],
        mentionOptionLabel: (value: string) => `@${value}`,
      };
      const props = {
        value: markdown,
        onChange,
        readOnly: true,
        vault: "reef-test",
      };
      const { container, rerender } = render(
        <IntlTestProvider locale="en">
          <MarkdownEditor {...props} mentionConfig={mentionConfig} />
        </IntlTestProvider>,
      );
      const people = () =>
        Array.from(
          container.querySelectorAll(
            '[data-markdown-reference="true"][data-markdown-reference-kind="person"]',
          ),
        );
      await waitFor(() => {
        expect(people()).toHaveLength(references.length);
        references.forEach((reference, index) => {
          expect(people()[index]).toHaveAttribute(
            "data-markdown-reference-resolution",
            "available",
          );
          expect(people()[index]).toHaveAttribute(
            "data-markdown-reference-id",
            reference.id,
          );
          expect(people()[index]).toHaveAttribute(
            "data-markdown-reference-value",
            reference.value,
          );
          expect(people()[index]).toHaveAttribute(
            "title",
            `${reference.value} — ${reference.title}`,
          );
        });
      });
      if (markdown.includes("REEF-001")) {
        const issue = container.querySelector(
          '[data-markdown-reference="true"][data-markdown-reference-kind="issue"]',
        );
        await waitFor(() =>
          expect(issue).toHaveAttribute(
            "href",
            "/workspace/reef-test/issues/REEF-001",
          ),
        );
        expect(issue).toHaveAttribute(
          "data-markdown-reference-title",
          "Auth flow",
        );
      }
      const removed = references[references.length - 1];
      rerender(
        <IntlTestProvider locale="en">
          <MarkdownEditor
            {...props}
            mentionConfig={{
              ...mentionConfig,
              members: members.filter(
                (member) => member.username !== removed.id,
              ),
            }}
          />
        </IntlTestProvider>,
      );
      await waitFor(() =>
        expect(people()[references.length - 1]).toHaveAttribute(
          "data-markdown-reference-resolution",
          "unavailable",
        ),
      );
      expect(people()[references.length - 1]).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(people()[references.length - 1]).toHaveAttribute(
        "data-markdown-reference-value",
        removed.value,
      );
      if (references.length === 2)
        expect(people()[0]).toHaveAttribute(
          "data-markdown-reference-resolution",
          "available",
        );
      rerender(
        <IntlTestProvider locale="en">
          <MarkdownEditor
            {...props}
            mentionConfig={{
              ...mentionConfig,
              members: [...members].reverse(),
            }}
          />
        </IntlTestProvider>,
      );
      await waitFor(() =>
        references.forEach((reference, index) => {
          expect(people()[index]).toHaveAttribute(
            "data-markdown-reference-resolution",
            "available",
          );
          expect(people()[index]).toHaveAttribute(
            "data-markdown-reference-id",
            reference.id,
          );
          expect(people()[index]).toHaveAttribute(
            "title",
            `${reference.value} — ${reference.title}`,
          );
        }),
      );
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("preserves core username and recipient identity through repeated public round trips", () => {
    const usernames = ["alice", "한글42", "Ada Lovelace", "team@ops\\blue}"];
    const markdown = `Before ${usernames.map(formatMentionToken).join(" and ")} after.`;
    const expectedReferences = usernames.map((username) => ({
      id: username,
      value: formatMentionToken(username),
    }));
    const expectedRecipients = buildResolvedMentionRecipients(
      markdown,
      usernames,
    );
    let current = markdown;

    expect(
      parseMentionTokens(markdown).map(({ username }) => username),
    ).toEqual(usernames);

    for (let pass = 0; pass < 3; pass += 1) {
      expect(
        extractMarkdownReferences(current)
          .filter(({ kind }) => kind === "person")
          .map(({ id, value }) => ({ id, value })),
      ).toEqual(expectedReferences);

      current = serializeMarkdown(
        parseMarkdown(current, { profile: "preserve" }),
        { profile: "preserve" },
      );

      expect(current).toBe(markdown);
      expect(
        parseMentionTokens(current).map(({ username }) => username),
      ).toEqual(usernames);
      expect(buildResolvedMentionRecipients(current, usernames)).toEqual(
        expectedRecipients,
      );
    }
  });

  it("changes shared toolbar labels when its locale provider changes", () => {
    const { rerender } = render(
      <MarkdownLocaleProvider locale="ko">
        <MarkdownToolbar editor={null} />
      </MarkdownLocaleProvider>,
    );

    expect(screen.getByRole("button", { name: "다시 실행" })).toBeDisabled();

    rerender(
      <MarkdownLocaleProvider locale="en">
        <MarkdownToolbar editor={null} />
      </MarkdownLocaleProvider>,
    );

    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });
});
