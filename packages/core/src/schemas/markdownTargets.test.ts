import { describe, expect, it } from "vitest";
import {
  MarkdownTargetAccessResultSchema,
  ResolveMarkdownTargetRequestSchema,
} from "./markdownTargets";

describe("Markdown target contracts", () => {
  it("keeps runtime URLs out of the access result", () => {
    expect(
      MarkdownTargetAccessResultSchema.safeParse({
        target: "akb://reef-test/coll/docs/doc/guide.md",
        kind: "document",
        status: "available",
      }).success,
    ).toBe(true);
    expect(
      MarkdownTargetAccessResultSchema.safeParse({
        target: "akb://reef-test/coll/docs/doc/guide.md",
        kind: "document",
        status: "available",
        runtimeUrl: "https://files.example/signed/secret",
      }).success,
    ).toBe(false);
  });

  it("accepts only one bounded target in a strict request", () => {
    expect(
      ResolveMarkdownTargetRequestSchema.safeParse({
        target: "akb://reef-test/coll/docs/doc/guide.md",
      }).success,
    ).toBe(true);
    expect(
      ResolveMarkdownTargetRequestSchema.safeParse({
        target: "akb://reef-test/table/pipeline",
        vault: "reef-test",
      }).success,
    ).toBe(false);
    expect(
      ResolveMarkdownTargetRequestSchema.safeParse({ target: "" }).success,
    ).toBe(false);
  });
});
