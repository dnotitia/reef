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
  type VaultMember,
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

  it("keeps exact username identities separate from authored mention tokens", async () => {
    const username = "team@ops\\blue}";
    const authoredToken = formatMentionToken(username);
    const onChange = vi.fn();
    const member = {
      username,
      display_name: "Operations owner",
    } as VaultMember;
    const { container } = render(
      <IntlTestProvider locale="en">
        <MarkdownEditor
          value={`Before ${authoredToken} after.`}
          onChange={onChange}
          readOnly
          mentionConfig={{
            members: [member],
            issues: [],
            mentionOptionLabel: (value) => `@${value}`,
          }}
        />
      </IntlTestProvider>,
    );
    await waitFor(() =>
      expect(
        container.querySelector('[data-markdown-reference="true"]'),
      ).toHaveAttribute("data-markdown-reference-resolution", "available"),
    );
    const reference = container.querySelector(
      '[data-markdown-reference="true"]',
    );
    if (!reference) {
      throw new Error("Shared Markdown surface did not render the mention");
    }

    expect(reference).toHaveAttribute("data-markdown-reference-id", username);
    expect(reference).toHaveAttribute(
      "data-markdown-reference-value",
      authoredToken,
    );
    expect(reference).toHaveAttribute(
      "data-markdown-reference-title",
      `@${username}`,
    );
    expect(onChange).not.toHaveBeenCalled();
  });

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
