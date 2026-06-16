// @vitest-environment node

import type { IssueMetadata } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  applyDependencyFilter,
  computeBlockedIds,
  getUnresolvedBlockerCount,
  isBlocked,
  isBlocking,
} from "./dependencyUtils";

const base = {
  created_at: "2026-04-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-04-01T00:00:00.000Z",
  updated_by: "alice",
} satisfies Partial<IssueMetadata>;

const openIssue = (id: string, dependsOn?: string[]): IssueMetadata => ({
  ...base,
  id,
  title: `Issue ${id}`,
  status: "todo",
  depends_on: dependsOn,
});

const doneIssue = (id: string): IssueMetadata => ({
  ...base,
  id,
  title: `Issue ${id}`,
  status: "done",
});

describe("isBlocked", () => {
  it("returns false when issue has no depends_on", () => {
    const issue = openIssue("A");
    expect(isBlocked(issue, [issue])).toBe(false);
  });

  it("returns true when depends_on target is open (unresolved)", () => {
    const blocker = openIssue("B");
    const issue = openIssue("A", ["B"]);
    expect(isBlocked(issue, [issue, blocker])).toBe(true);
  });

  it("returns false when all depends_on targets are done", () => {
    const resolved = doneIssue("B");
    const issue = openIssue("A", ["B"]);
    expect(isBlocked(issue, [issue, resolved])).toBe(false);
  });

  it("returns true when depends_on target is missing from allIssues", () => {
    const issue = openIssue("A", ["MISSING"]);
    expect(isBlocked(issue, [issue])).toBe(true);
  });

  it("returns true when one blocker is done but another is still open", () => {
    const resolved = doneIssue("B");
    const open = openIssue("C");
    const issue = openIssue("A", ["B", "C"]);
    expect(isBlocked(issue, [issue, resolved, open])).toBe(true);
  });
});

describe("isBlocking", () => {
  it("returns false when no other issue depends on this issue", () => {
    const issue = openIssue("A");
    const other = openIssue("B");
    expect(isBlocking(issue, [issue, other])).toBe(false);
  });

  it("returns true when an open issue depends on this issue", () => {
    const issue = openIssue("A");
    const dependent = openIssue("B", ["A"]);
    expect(isBlocking(issue, [issue, dependent])).toBe(true);
  });

  it("returns false when all dependent issues are done", () => {
    const issue = openIssue("A");
    const doneDep = doneIssue("B");
    // doneDep won't have depends_on but this tests the resolved status check
    expect(isBlocking(issue, [issue, doneDep])).toBe(false);
  });

  it("does not count itself as a blocker", () => {
    const issue = openIssue("A", ["A"]);
    expect(isBlocking(issue, [issue])).toBe(false);
  });
});

describe("getUnresolvedBlockerCount", () => {
  it("returns 0 when no depends_on", () => {
    const issue = openIssue("A");
    expect(getUnresolvedBlockerCount(issue, [issue])).toBe(0);
  });

  it("returns count of unresolved blockers", () => {
    const b1 = openIssue("B");
    const b2 = doneIssue("C");
    const issue = openIssue("A", ["B", "C"]);
    expect(getUnresolvedBlockerCount(issue, [issue, b1, b2])).toBe(1);
  });

  it("returns all count when all blockers unresolved", () => {
    const b1 = openIssue("B");
    const b2 = openIssue("C");
    const issue = openIssue("A", ["B", "C"]);
    expect(getUnresolvedBlockerCount(issue, [issue, b1, b2])).toBe(2);
  });
});

describe("applyDependencyFilter", () => {
  it("returns all issues when filter is null (no-op)", () => {
    const issues = [openIssue("A"), openIssue("B")];
    expect(applyDependencyFilter(issues, null, issues)).toEqual(issues);
  });

  it("filters to blocked issues only", () => {
    const blocker = openIssue("B");
    const blocked = openIssue("A", ["B"]);
    const free = openIssue("C");
    const all = [blocked, free, blocker];
    const result = applyDependencyFilter([blocked, free], ["blocked"], all);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("A");
  });

  it("filters to blocking issues only", () => {
    const blocking = openIssue("B");
    const dependent = openIssue("A", ["B"]);
    const free = openIssue("C");
    const all = [blocking, dependent, free];
    const result = applyDependencyFilter([blocking, free], ["blocking"], all);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("B");
  });

  it("matches blocked OR blocking when both are selected (REEF-031)", () => {
    const blocker = openIssue("B");
    const blocked = openIssue("A", ["B"]); // depends on B → blocked AND nothing depends on it
    const free = openIssue("C");
    const all = [blocked, free, blocker];
    const result = applyDependencyFilter(
      [blocked, free, blocker],
      ["blocked", "blocking"],
      all,
    );
    // blocked (depends on B) + blocker B (A depends on it) match; free does not.
    expect(result.map((i) => i.id).sort()).toEqual(["A", "B"]);
  });

  it("returns all issues when filter is an empty array (no-op)", () => {
    const issues = [openIssue("A"), openIssue("B")];
    expect(applyDependencyFilter(issues, [], issues)).toEqual(issues);
  });

  it("returns empty array when no issues match blocked filter", () => {
    const resolved = doneIssue("B");
    const issue = openIssue("A", ["B"]);
    const all = [issue, resolved];
    const result = applyDependencyFilter([issue], ["blocked"], all);
    expect(result).toHaveLength(0);
  });
});

describe("computeBlockedIds", () => {
  it("collects ids whose depends_on has an unresolved target", () => {
    const a = openIssue("A", ["B"]); // B is open → blocked
    const b = openIssue("B");
    const c = openIssue("C", ["D"]); // D is done → not blocked
    const d = doneIssue("D");
    const issues = [a, b, c, d];

    const blocked = computeBlockedIds(issues, issues);
    expect(blocked.has("A")).toBe(true);
    expect(blocked.has("C")).toBe(false);
    expect(blocked.has("B")).toBe(false);
  });

  it("reads depends_on from `issues` and statuses from `graph` (optimistic overlay)", () => {
    // The list item carries the freshly-edited dependency; the graph still has
    // the pre-edit projection with no dependency. Blocked state should follow the
    // optimistic list item, not the stale graph node. (REEF-097 autoreview)
    const optimistic = openIssue("A", ["B"]);
    const staleGraphNode = openIssue("A"); // no depends_on yet
    const blocker = openIssue("B"); // open → unresolved

    const blocked = computeBlockedIds([optimistic], [staleGraphNode, blocker]);
    expect(blocked.has("A")).toBe(true);
  });

  it("treats a dependency missing from the graph as unresolved", () => {
    const a = openIssue("A", ["ghost"]);
    const blocked = computeBlockedIds([a], [a]);
    expect(blocked.has("A")).toBe(true);
  });
});
