// @vitest-environment node

import type { IssueMetadata } from "@reef/core";
import { describe, expect, it, vi } from "vitest";
import {
  filterIssues,
  formatLabelFilter,
  matchesSharedFacets,
  parseLabelFilter,
  searchIssues,
  sortIssues,
} from "./issueListUtils";

const base = {
  created_by: "alice",
  updated_by: "alice",
} satisfies Partial<IssueMetadata>;

const makeIssue = (
  overrides: Partial<IssueMetadata> & { id: string },
): IssueMetadata => ({
  ...base,
  title: `Issue ${overrides.id}`,
  status: "todo",
  created_at: "2026-04-01T00:00:00.000Z",
  updated_at: "2026-04-01T00:00:00.000Z",
  ...overrides,
});

const issues: IssueMetadata[] = [
  makeIssue({
    id: "REEF-001",
    title: "Setup workspace",
    status: "done",
    priority: "high",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-04-05T00:00:00.000Z",
    assigned_to: "alice",
    labels: ["infra"],
  }),
  makeIssue({
    id: "REEF-002",
    title: "Auth flow",
    status: "todo",
    priority: "critical",
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-04-03T00:00:00.000Z",
    assigned_to: "bob",
    labels: ["auth", "security"],
  }),
  makeIssue({
    id: "REEF-003",
    title: "UI redesign",
    status: "in_progress",
    priority: "medium",
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    assigned_to: "alice",
    labels: ["ui", "design"],
  }),
  makeIssue({
    id: "REEF-004",
    title: "Write docs",
    status: "todo",
    priority: "low",
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-02T00:00:00.000Z",
  }),
];

describe("sortIssues", () => {
  it("returns copy with original order when no field specified", () => {
    const sorted = sortIssues(issues, undefined, undefined);
    expect(sorted.map((i) => i.id)).toEqual([
      "REEF-001",
      "REEF-002",
      "REEF-003",
      "REEF-004",
    ]);
  });

  it("sorts by created_at ascending", () => {
    const sorted = sortIssues(issues, "created_at", "asc");
    expect(sorted[0].id).toBe("REEF-001");
    expect(sorted[3].id).toBe("REEF-004");
  });

  it("sorts by created_at descending", () => {
    const sorted = sortIssues(issues, "created_at", "desc");
    expect(sorted[0].id).toBe("REEF-004");
    expect(sorted[3].id).toBe("REEF-001");
  });

  it("sorts by updated_at ascending", () => {
    const sorted = sortIssues(issues, "updated_at", "asc");
    // REEF-004 updated_at 2026-04-02, REEF-003 updated_at 2026-04-01 (earliest = first)
    expect(sorted[0].id).toBe("REEF-003");
    expect(sorted[3].id).toBe("REEF-001");
  });

  it("sorts by updated_at descending", () => {
    const sorted = sortIssues(issues, "updated_at", "desc");
    expect(sorted[0].id).toBe("REEF-001");
  });

  it("sorts by priority ascending (low first)", () => {
    const sorted = sortIssues(issues, "priority", "asc");
    expect(sorted[0].id).toBe("REEF-004"); // low
    expect(sorted[3].id).toBe("REEF-002"); // critical
  });

  it("sorts by priority descending (critical first)", () => {
    const sorted = sortIssues(issues, "priority", "desc");
    expect(sorted[0].id).toBe("REEF-002"); // critical
    expect(sorted[3].id).toBe("REEF-004"); // low
  });

  it("sorts by title A→Z (localeCompare) ascending", () => {
    // "Auth flow" < "Setup workspace" < "UI redesign" < "Write docs"
    const sorted = sortIssues(issues, "title", "asc");
    expect(sorted.map((i) => i.id)).toEqual([
      "REEF-002",
      "REEF-001",
      "REEF-003",
      "REEF-004",
    ]);
  });

  it("sorts by title Z→A descending", () => {
    const sorted = sortIssues(issues, "title", "desc");
    expect(sorted[0].id).toBe("REEF-004"); // Write docs
    expect(sorted[3].id).toBe("REEF-002"); // Auth flow
  });

  it("sorts by estimate_points, treating null as 0", () => {
    const pointed = [
      makeIssue({ id: "REEF-010", estimate_points: 5 }),
      makeIssue({ id: "REEF-011", estimate_points: null }),
      makeIssue({ id: "REEF-012", estimate_points: 13 }),
      makeIssue({ id: "REEF-013", estimate_points: 1 }),
    ];
    const asc = sortIssues(pointed, "estimate_points", "asc");
    expect(asc.map((i) => i.id)).toEqual([
      "REEF-011", // null → 0
      "REEF-013", // 1
      "REEF-010", // 5
      "REEF-012", // 13
    ]);
    const desc = sortIssues(pointed, "estimate_points", "desc");
    expect(desc[0].id).toBe("REEF-012"); // 13
    expect(desc[3].id).toBe("REEF-011"); // null → 0
  });

  it("does not mutate input array", () => {
    const original = [...issues];
    sortIssues(issues, "priority", "desc");
    expect(issues.map((i) => i.id)).toEqual(original.map((i) => i.id));
  });
});

describe("filterIssues", () => {
  it("returns all issues when filter is empty", () => {
    expect(filterIssues(issues, {})).toHaveLength(4);
  });

  it("filters by status", () => {
    const result = filterIssues(issues, { status: ["todo"] });
    expect(result).toHaveLength(2);
    expect(result.every((i) => i.status === "todo")).toBe(true);
  });

  it("filters by multiple statuses (OR within the facet) (REEF-031)", () => {
    const result = filterIssues(issues, { status: ["todo", "in_progress"] });
    // REEF-002 + REEF-004 (open) + REEF-003 (in_progress) = 3
    expect(result.map((i) => i.id).sort()).toEqual([
      "REEF-002",
      "REEF-003",
      "REEF-004",
    ]);
  });

  it("filters by priority", () => {
    const result = filterIssues(issues, { priority: ["critical"] });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("REEF-002");
  });

  it("filters by assignee (case-insensitive partial match)", () => {
    const result = filterIssues(issues, { assignee: "alice" });
    expect(result).toHaveLength(2);
  });

  it("filters by label (single label)", () => {
    const result = filterIssues(issues, { label: "auth" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("REEF-002");
  });

  it("filters by label (comma-separated multiple labels match any)", () => {
    const result = filterIssues(issues, { label: "auth,infra" });
    expect(result).toHaveLength(2);
  });

  it("returns empty when no issues match combined filter", () => {
    const result = filterIssues(issues, {
      status: ["done"],
      priority: ["low"],
    });
    expect(result).toHaveLength(0);
  });

  it("hides archived issues by default", () => {
    const withArchived: IssueMetadata[] = [
      ...issues,
      makeIssue({
        id: "REEF-099",
        title: "Old experiment",
        status: "todo",
        archived_at: "2026-04-30T00:00:00.000Z",
      }),
    ];
    const result = filterIssues(withArchived, {});
    expect(result).toHaveLength(4);
    expect(result.some((i) => i.id === "REEF-099")).toBe(false);
  });

  it("includes archived issues when showArchived is true", () => {
    const withArchived: IssueMetadata[] = [
      ...issues,
      makeIssue({
        id: "REEF-099",
        title: "Old experiment",
        status: "todo",
        archived_at: "2026-04-30T00:00:00.000Z",
      }),
    ];
    const result = filterIssues(withArchived, { showArchived: true });
    expect(result).toHaveLength(5);
    expect(result.some((i) => i.id === "REEF-099")).toBe(true);
  });

  it("archive filter composes with status filter", () => {
    const withArchived: IssueMetadata[] = [
      ...issues,
      makeIssue({
        id: "REEF-099",
        title: "Old experiment",
        status: "todo",
        archived_at: "2026-04-30T00:00:00.000Z",
      }),
    ];
    // Even with showArchived true, status filter still applies.
    const result = filterIssues(withArchived, {
      showArchived: true,
      status: ["todo"],
    });
    // Originals with status=open: REEF-002, REEF-004 (2). Plus REEF-099 = 3.
    expect(result).toHaveLength(3);
  });

  it("excludes done and closed issues from overdue due filter", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T00:00:00.000Z"));

    try {
      const result = filterIssues(
        [
          makeIssue({
            id: "REEF-101",
            status: "todo",
            due_date: "2026-06-01",
          }),
          makeIssue({
            id: "REEF-102",
            status: "in_review",
            due_date: "2026-06-01",
          }),
          makeIssue({
            id: "REEF-103",
            status: "done",
            due_date: "2026-06-01",
          }),
          makeIssue({
            id: "REEF-104",
            status: "closed",
            due_date: "2026-06-01",
          }),
        ],
        { due: ["overdue"] },
      );

      expect(result.map((issue) => issue.id)).toEqual(["REEF-101", "REEF-102"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("searchIssues", () => {
  it("returns all issues when query is empty", () => {
    expect(searchIssues(issues, "")).toHaveLength(4);
  });

  it("matches by id", () => {
    const result = searchIssues(issues, "REEF-001");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("REEF-001");
  });

  it("matches by title", () => {
    const result = searchIssues(issues, "auth flow");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("REEF-002");
  });

  it("case-insensitive search", () => {
    const result = searchIssues(issues, "AUTH");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("REEF-002");
  });

  it("matches by assignee", () => {
    const result = searchIssues(issues, "bob");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("REEF-002");
  });

  it("matches by label", () => {
    const result = searchIssues(issues, "security");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("REEF-002");
  });

  it("returns empty when no match", () => {
    const result = searchIssues(issues, "zzznomatch");
    expect(result).toHaveLength(0);
  });

  it("handles whitespace-only query as empty (returns all)", () => {
    expect(searchIssues(issues, "   ")).toHaveLength(4);
  });
});

// The shared facet predicate is the single matching contract used by both the
// issues list and the reports scope bar (REEF-074).
describe("matchesSharedFacets", () => {
  const issue = makeIssue({
    id: "REEF-100",
    assigned_to: "Alice",
    labels: ["UI", "risk"],
    sprint_id: "spr-1",
    milestone_id: "mil-1",
    release_id: "rel-1",
  });

  it("passes when every facet is unset", () => {
    expect(matchesSharedFacets(issue, {})).toBe(true);
  });

  it("matches assignee case-insensitively as a substring", () => {
    expect(matchesSharedFacets(issue, { assignee: "ali" })).toBe(true);
    expect(matchesSharedFacets(issue, { assignee: "bob" })).toBe(false);
  });

  it("requires exact planning-id equality", () => {
    expect(matchesSharedFacets(issue, { sprint_id: "spr-1" })).toBe(true);
    expect(matchesSharedFacets(issue, { sprint_id: "spr-2" })).toBe(false);
    expect(matchesSharedFacets(issue, { milestone_id: "mil-9" })).toBe(false);
    expect(matchesSharedFacets(issue, { release_id: "rel-1" })).toBe(true);
  });

  it("matches the parent issue id exactly (reports rollup drill, REEF-187)", () => {
    const child = makeIssue({ id: "REEF-200", parent_id: "REEF-001" });
    expect(matchesSharedFacets(child, { parent_id: "REEF-001" })).toBe(true);
    expect(matchesSharedFacets(child, { parent_id: "REEF-999" })).toBe(false);
    // An issue with no parent does not match a parent facet.
    expect(matchesSharedFacets(issue, { parent_id: "REEF-001" })).toBe(false);
  });

  it("OR-matches comma-separated labels, case-insensitively and exact-token", () => {
    expect(matchesSharedFacets(issue, { label: "risk" })).toBe(true);
    expect(matchesSharedFacets(issue, { label: "ui" })).toBe(true);
    expect(matchesSharedFacets(issue, { label: "missing,risk" })).toBe(true);
    expect(matchesSharedFacets(issue, { label: "ris" })).toBe(false);
    expect(matchesSharedFacets(issue, { label: "missing" })).toBe(false);
  });

  it("ANDs across facets", () => {
    expect(
      matchesSharedFacets(issue, { assignee: "alice", label: "risk" }),
    ).toBe(true);
    expect(
      matchesSharedFacets(issue, { assignee: "alice", label: "missing" }),
    ).toBe(false);
  });

  it("round-trips label parse/format", () => {
    expect(parseLabelFilter("ui, risk ,, ")).toEqual(["ui", "risk"]);
    expect(formatLabelFilter(["ui", "risk"])).toBe("ui,risk");
    expect(formatLabelFilter([])).toBeUndefined();
    expect(parseLabelFilter(undefined)).toEqual([]);
  });
});
