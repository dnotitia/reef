// @vitest-environment node
import { describe, expect, it } from "vitest";
import { issueRunEligibilityKey } from "./useIssueRunEligibility";

describe("issueRunEligibilityKey", () => {
  it("is scoped by issue, vault, and run-eligibility domain", () => {
    expect(issueRunEligibilityKey("reef-acme", "REEF-382")).toEqual([
      "issues",
      "run-eligibility",
      "reef-acme",
      "REEF-382",
    ]);
  });
});
