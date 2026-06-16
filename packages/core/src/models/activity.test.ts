import { describe, expect, it } from "vitest";
import { extractIssueRefs } from "./activity";

describe("extractIssueRefs", () => {
  it("extracts a single issue ref", () => {
    expect(extractIssueRefs("fix: REEF-042")).toEqual(["REEF-042"]);
  });

  it("extracts multiple distinct refs", () => {
    expect(
      extractIssueRefs("fixes REEF-042, closes REEF-100, relates to REEF-999"),
    ).toEqual(["REEF-042", "REEF-100", "REEF-999"]);
  });

  it("returns empty array when no refs found", () => {
    expect(extractIssueRefs("chore: update readme")).toEqual([]);
  });

  it("deduplicates repeated refs", () => {
    expect(
      extractIssueRefs("REEF-042 and REEF-042 again and REEF-042"),
    ).toEqual(["REEF-042"]);
  });

  it("is case-insensitive on the prefix", () => {
    expect(extractIssueRefs("reef-042 REEF-043 Reef-044")).toEqual([
      "REEF-042",
      "REEF-043",
      "REEF-044",
    ]);
  });

  it("handles non-standard prefix", () => {
    expect(extractIssueRefs("fixes PROJ-001 and PROJ-002", "PROJ")).toEqual([
      "PROJ-001",
      "PROJ-002",
    ]);
  });

  it("does NOT match short numeric suffixes (fewer than 3 digits)", () => {
    // Pattern requires \d{3,} — two-digit IDs are not valid
    expect(extractIssueRefs("REEF-01 REEF-1 REEF-99")).toEqual([]);
  });

  it("handles multi-line text (commit message with body)", () => {
    const msg = `feat: implement dark mode

Implements REEF-042. Also see REEF-100 for related context.
Fixes REEF-200.`;
    expect(extractIssueRefs(msg)).toEqual(["REEF-042", "REEF-100", "REEF-200"]);
  });

  it("does not match IDs preceded by another uppercase letter or digit (negative lookbehind)", () => {
    // XREEF-042 should not match
    expect(extractIssueRefs("XREEF-042")).toEqual([]);
  });

  it("handles branch name with issue ref", () => {
    expect(extractIssueRefs("feat/REEF-042-dark-mode")).toEqual(["REEF-042"]);
  });

  it("sorts results alphabetically / numerically", () => {
    expect(extractIssueRefs("REEF-200 REEF-042 REEF-100")).toEqual([
      "REEF-042",
      "REEF-100",
      "REEF-200",
    ]);
  });

  it("escapes regex metacharacters in prefix (e.g. dot does not wildcard-match)", () => {
    // "RE.F" as a raw regex would match "REXF-001", but after escaping it should not
    expect(extractIssueRefs("REXF-001 RE.F-002", "RE.F")).toEqual(["RE.F-002"]);
  });

  it("handles prefix with special regex chars like + or *", () => {
    expect(extractIssueRefs("A+B-001 A+B-002 AXB-003", "A+B")).toEqual([
      "A+B-001",
      "A+B-002",
    ]);
  });
});
