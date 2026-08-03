// @vitest-environment node

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
      "@alice \\@alice alice@example.com `@alice` [@alice](https://x)";
    const out = run(
      "",
      ["alice"],
      [
        { type: "inlineCode", value: "@alice" },
        {
          type: "link",
          url: "https://x",
          children: [{ type: "text", value: "@alice" }],
        },
        { type: "text", value: "@unknown" },
        positionedText(source),
      ],
    );

    expect(out[0]).toEqual({ type: "inlineCode", value: "@alice" });
    expect(out[1]?.type).toBe("link");
    expect(out[2]?.value).toBe("@unknown");
    expect(out.some((node) => node.data?.hProperties?.dataReefMention)).toBe(
      false,
    );
  });

  it("does not create links or nested interactive nodes", () => {
    const out = run("@alice", ["alice"], [positionedText("@alice")]);
    expect(out[1]).toBeUndefined();
    expect(out[0]).toMatchObject({
      data: { hName: "span" },
    });
  });
});
