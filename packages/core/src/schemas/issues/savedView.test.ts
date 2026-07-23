import { describe, expect, it } from "vitest";
import {
  SavedIssueViewPayloadSchema,
  normalizeSavedIssueViewName,
} from "./savedView";

describe("saved issue views", () => {
  it("normalizes names with trim, NFKC, and locale-independent lowercase", () => {
    expect(normalizeSavedIssueViewName("  ＭＹ View  ")).toBe("my view");
    expect(normalizeSavedIssueViewName("İ")).toBe("i̇");
  });

  it("accepts the versioned canonical query envelope", () => {
    expect(
      SavedIssueViewPayloadSchema.parse({
        version: 1,
        query: { status: ["todo"], view: ["list"] },
      }),
    ).toEqual({
      version: 1,
      query: { status: ["todo"], view: ["list"] },
    });
  });

  it("keeps create payload validation strict", () => {
    expect(
      SavedIssueViewPayloadSchema.safeParse({
        version: 1,
        query: { status: ["todo", 42] },
      }).success,
    ).toBe(false);
  });
});
