import type { IssueMetadata } from "@reef/core";
import { describe, expect, it } from "vitest";
import { issueProjection } from "./targetSupport.js";

describe("issueProjection", () => {
  it("normalizes an absent labels array to the empty desired value", () => {
    expect(
      issueProjection({} as IssueMetadata, ["labels", "assigned_to"]),
    ).toEqual({
      labels: [],
      assigned_to: null,
    });
  });
});
