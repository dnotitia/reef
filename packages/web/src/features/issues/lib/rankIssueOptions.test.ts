// @vitest-environment node

import type { IssueMetadata } from "@reef/core";
import { describe, expect, it } from "vitest";
import { rankIssueOptions } from "./rankIssueOptions";

function makeIssue(
  overrides: Partial<IssueMetadata> & { id: string; title: string },
) {
  return {
    status: "todo",
    created_at: "2026-04-13T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-04-13T00:00:00.000Z",
    updated_by: "alice",
    ...overrides,
  } as IssueMetadata;
}

describe("rankIssueOptions", () => {
  const issues: IssueMetadata[] = [
    makeIssue({ id: "REEF-001", title: "Fix login bug" }),
    makeIssue({ id: "REEF-002", title: "Add login form" }),
    makeIssue({ id: "REEF-003", title: "Build search palette" }),
    makeIssue({
      id: "REEF-004",
      title: "Archived: older",
      archived_at: "2026-05-01T00:00:00.000Z",
    }),
  ];

  it("returns [] for an empty or whitespace query", () => {
    expect(rankIssueOptions(issues, "")).toEqual([]);
    expect(rankIssueOptions(issues, "   ")).toEqual([]);
  });

  it("matches case-insensitively against title", () => {
    const results = rankIssueOptions(issues, "LOGIN");
    expect(results.map((m) => m.issue.id)).toEqual(["REEF-001", "REEF-002"]);
    expect(results[0]?.matchedField).toBe("title");
  });

  it("ranks ID matches above title matches", () => {
    const results = rankIssueOptions(issues, "003");
    // just REEF-003 matches in id; no title has "003".
    expect(results.map((m) => m.issue.id)).toEqual(["REEF-003"]);
    expect(results[0]?.matchedField).toBe("id");
  });

  it("excludes archived issues even on a direct id hit", () => {
    const results = rankIssueOptions(issues, "REEF-004");
    expect(results).toEqual([]);
  });

  it("orders title matches by earliest match index, then by id", () => {
    const haystack: IssueMetadata[] = [
      makeIssue({ id: "REEF-010", title: "Buggy fix needed" }),
      makeIssue({ id: "REEF-011", title: "Fix the login bug" }),
      makeIssue({ id: "REEF-012", title: "bug everywhere" }),
    ];
    const results = rankIssueOptions(haystack, "bug");
    expect(results.map((m) => m.issue.id)).toEqual([
      "REEF-010", // index 0 ("Buggy ..."), id sorts first
      "REEF-012", // index 0 ("bug everywhere"), id sorts after
      "REEF-011", // later index
    ]);
  });

  it("honors the limit argument", () => {
    const haystack: IssueMetadata[] = Array.from({ length: 30 }, (_, i) =>
      makeIssue({
        id: `REEF-${String(i + 1).padStart(3, "0")}`,
        title: "match me",
      }),
    );
    expect(rankIssueOptions(haystack, "match", 5)).toHaveLength(5);
  });
});
