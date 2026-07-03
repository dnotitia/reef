// @vitest-environment node

import { describe, expect, it } from "vitest";
import { remarkReefMentions } from "./remarkReefMentions";

interface Node {
  type: string;
  value?: string;
  url?: string;
  data?: { hProperties?: Record<string, unknown> };
  children?: Node[];
}

function paragraph(...children: Node[]): Node {
  return { type: "root", children: [{ type: "paragraph", children }] };
}

function run(tree: Node, known: string[]) {
  const knownSet = new Set(known);
  remarkReefMentions({
    isKnown: (id) => knownSet.has(id),
    hrefFor: (id) => `/workspace/reef-e2e/issues/${id}`,
  })(tree as never);
  return tree.children?.[0]?.children ?? [];
}

describe("remarkReefMentions", () => {
  it("links known ids and leaves unknown ids as text (AC3)", () => {
    const out = run(
      paragraph({ type: "text", value: "See REEF-1 and REEF-9 plus REEF-2." }),
      ["REEF-1", "REEF-2"],
    );
    expect(out.map((n) => n.type)).toEqual([
      "text",
      "link",
      "text",
      "link",
      "text",
    ]);
    expect(out[0].value).toBe("See ");
    expect(out[1].url).toBe("/workspace/reef-e2e/issues/REEF-1");
    expect(out[1].data?.hProperties).toEqual({ "data-reef-id": "REEF-1" });
    // The unknown REEF-9 stays inside the plain text segment.
    expect(out[2].value).toBe(" and REEF-9 plus ");
    expect(out[3].url).toBe("/workspace/reef-e2e/issues/REEF-2");
    expect(out[4].value).toBe(".");
  });

  it("returns a single text node when no known id is present", () => {
    const out = run(paragraph({ type: "text", value: "no ids here" }), [
      "REEF-1",
    ]);
    expect(out).toEqual([{ type: "text", value: "no ids here" }]);
  });

  it("matches ids case-insensitively but links to the uppercase id", () => {
    const out = run(paragraph({ type: "text", value: "ref reef-42 done" }), [
      "REEF-42",
    ]);
    expect(out[1].type).toBe("link");
    expect(out[1].url).toBe("/workspace/reef-e2e/issues/REEF-42");
    // The visible label keeps the original casing.
    expect(out[1].children?.[0]?.value).toBe("reef-42");
  });

  it("does not linkify inside inline code or existing links", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "inlineCode", value: "REEF-1" },
            { type: "text", value: " and " },
            {
              type: "link",
              url: "https://x",
              children: [{ type: "text", value: "REEF-1" }],
            },
          ],
        },
      ],
    };
    run(tree, ["REEF-1"]);
    const kids = tree.children?.[0]?.children ?? [];
    expect(kids[0]).toEqual({ type: "inlineCode", value: "REEF-1" });
    // The link's inner text is untouched (no nested anchor).
    expect(kids[2].children?.[0]).toEqual({ type: "text", value: "REEF-1" });
  });

  it("ignores mid-identifier matches", () => {
    const out = run(paragraph({ type: "text", value: "xREEF-1 REEF-1x" }), [
      "REEF-1",
    ]);
    // Neither token is a standalone REEF id, so nothing links.
    expect(out.every((n) => n.type === "text")).toBe(true);
  });
});
