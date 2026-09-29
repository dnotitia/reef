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
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
