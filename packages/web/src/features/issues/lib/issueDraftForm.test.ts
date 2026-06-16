// @vitest-environment node

import { describe, expect, it } from "vitest";
import { formatLabelsInput, parseLabelsInput } from "./issueDraftForm";

describe("issueDraftForm", () => {
  it("formats labels with the same comma-separated syntax shown in issue forms", () => {
    expect(formatLabelsInput(["bug", "feature"])).toBe("bug, feature");
    expect(formatLabelsInput(undefined)).toBe("");
  });

  it("parses comma-separated labels and ignores empty entries", () => {
    expect(parseLabelsInput(" bug, feature ,,  docs ")).toEqual([
      "bug",
      "feature",
      "docs",
    ]);
  });
});
