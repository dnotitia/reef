import { describe, expect, it } from "vitest";
import { AkbSearchHitSchema } from "./http";

describe("AkbSearchHitSchema", () => {
  it("accepts a hit whose title is null (untitled akb document)", () => {
    const parsed = AkbSearchHitSchema.safeParse({
      uri: "akb://v/coll/specs/doc/y.md",
      title: null,
      source_type: "document",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a hit with a string title", () => {
    const parsed = AkbSearchHitSchema.safeParse({
      uri: "akb://v/coll/specs/doc/y.md",
      title: "Spec",
      source_type: "document",
    });
    expect(parsed.success).toBe(true);
  });
});
