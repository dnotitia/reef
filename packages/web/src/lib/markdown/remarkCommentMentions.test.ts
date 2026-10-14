// @vitest-environment node

import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it } from "vitest";
import { remarkCommentMentions } from "./remarkCommentMentions";

interface Node {
  type: string;
  value?: string;
  url?: string;
  data?: { hProperties?: Record<string, unknown>; hName?: string };
  children?: Node[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

function run(source: string, known: string[], children: Node[]): Node[] {
  const tree: Node = {
    type: "root",
    children: [{ type: "paragraph", children }],
  };
  const plugin = remarkCommentMentions({
    knownUsernames: new Set(known),
    cacheFingerprint: source,
  });
  plugin(tree as never, { value: source });
  return tree.children?.[0]?.children ?? [];
}

function positionedText(source: string): Node {
  return {
    type: "text",
    value: source,
    position: { start: { offset: 0 }, end: { offset: source.length } },
  };
}

describe("remarkCommentMentions", () => {
  it("styles only persisted compact and braced recipients with a plain label", () => {
    const source = "hello @alice and @{Alice Smith}";
    const out = run(source, ["alice", "Alice Smith"], [positionedText(source)]);

    expect(out.map((node) => node.data?.hProperties?.dataReefMention)).toEqual([
      undefined,
      "alice",
      undefined,
      "Alice Smith",
    ]);
    expect(out[1]).toMatchObject({
      type: "strong",
      children: [{ type: "text", value: "@alice" }],
      data: {
        hName: "span",
        hProperties: {
          dataReefMention: "alice",
        },
      },
    });
    expect(out[3]?.children).toEqual([
      expect.objectContaining({ type: "text", value: "@Alice Smith" }),
    ]);
  });

  it("keeps unknown, escaped, email, code, and link text unstyled", () => {
    const source =
      "@alice \\@alice @unknown alice@example.com `@alice` [@alice](https://x)";
    const tree = fromMarkdown(source);
    remarkCommentMentions({
      knownUsernames: new Set(["alice", "example.com"]),
    })(tree, { value: source });
    const paragraph = tree.children[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") throw new Error("expected paragraph");
    expect(paragraph.children).toEqual([
      expect.objectContaining({
        type: "strong",
        data: { hName: "span", hProperties: { dataReefMention: "alice" } },
        children: [{ type: "text", value: "@alice" }],
      }),
      { type: "text", value: " @alice @unknown alice@example.com " },
      expect.objectContaining({ type: "inlineCode", value: "@alice" }),
      { type: "text", value: " " },
      expect.objectContaining({
        type: "link",
        url: "https://x",
        children: [expect.objectContaining({ type: "text", value: "@alice" })],
      }),
    ]);
  });

  it("does not create links or nested interactive nodes", () => {
    const out = run("@alice", ["alice"], [positionedText("@alice")]);
    expect(out[1]).toBeUndefined();
    expect(out[0]).toMatchObject({
      data: { hName: "span" },
    });
  });
});
