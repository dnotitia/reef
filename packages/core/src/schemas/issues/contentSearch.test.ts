import { describe, expect, it } from "vitest";
import {
  IssueContentSearchRequestSchema,
  IssueContentSearchResponseSchema,
} from "./contentSearch";

describe("IssueContentSearchRequestSchema", () => {
  it("trims and accepts two Unicode code points", () => {
    expect(
      IssueContentSearchRequestSchema.parse({ q: "  검색  ", limit: 10 }),
    ).toEqual({ q: "검색", limit: 10 });
  });

  it.each([
    [{ q: "가", limit: 10 }],
    [{ q: "ok", limit: 11 }],
    [{ q: "ok", limit: 0 }],
    [{ q: "ok", limit: 60 }],
    [{ q: "a".repeat(181), limit: 10 }],
  ])("rejects invalid input %#", (value) => {
    expect(IssueContentSearchRequestSchema.safeParse(value).success).toBe(
      false,
    );
  });
});

describe("IssueContentSearchResponseSchema", () => {
  it("keeps source-specific scores and bounded snippets", () => {
    const parsed = IssueContentSearchResponseSchema.parse({
      results: [
        {
          reef_id: "REEF-001",
          title: "Search",
          snippet: "semantic body",
          source: "body",
          score: 0.42,
          match_id: "body:akb://reef/coll/issues/doc/reef-001.md",
        },
        {
          reef_id: "REEF-001",
          title: "Search",
          snippet: "literal comment",
          source: "comment",
          score: null,
          match_id: "comment:c-1",
        },
      ],
      has_more: false,
    });
    expect(parsed.results.map((result) => result.score)).toEqual([0.42, null]);
  });
});
