// @vitest-environment node

import type { IssueMetadata } from "@reef/core";
import { ISSUE_FIELD_MESSAGES_EN } from "@reef/core/fields";
import { describe, expect, it } from "vitest";
import type { ReportFilters } from "./aggregate";
import {
  PIVOT_FIELD_KEYS,
  type PivotResult,
  type PivotValueLabels,
  computePivot,
  pivotCell,
} from "./pivot";

// The enum-axis value labels the pivot bakes into its result are locale-resolved
// at the call site (REEF-292); the tests assert the en strings, so feed the en
// base catalog directly.
const LABELS: PivotValueLabels = {
  status: ISSUE_FIELD_MESSAGES_EN.status,
  type: ISSUE_FIELD_MESSAGES_EN.issueType,
  priority: ISSUE_FIELD_MESSAGES_EN.priority,
  severity: ISSUE_FIELD_MESSAGES_EN.severity,
};

function makeIssue(overrides: Partial<IssueMetadata>): IssueMetadata {
  return {
    id: "REEF-001",
    title: "Sample",
    status: "todo",
    created_at: "2026-04-13T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-04-13T00:00:00.000Z",
    updated_by: "alice",
    ...overrides,
  };
}

const sumMap = (m: ReadonlyMap<string, number>): number => {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
};

const sumCells = (r: PivotResult): number => {
  let s = 0;
  for (const inner of r.cells.values()) for (const v of inner.values()) s += v;
  return s;
};

/** Internal consistency every crosstab needs to hold: the grand total equals the
 *  sum of the row totals, the column totals, and the visible cells (REEF-189
 *  AC3). */
function expectConsistentTotals(r: PivotResult): void {
  expect(sumMap(r.rowTotals)).toBe(r.grandTotal);
  expect(sumMap(r.colTotals)).toBe(r.grandTotal);
  expect(sumCells(r)).toBe(r.grandTotal);
}

describe("computePivot — axis fields (AC2)", () => {
  it("offers exactly the six categorical issue fields", () => {
    expect(PIVOT_FIELD_KEYS).toEqual([
      "status",
      "type",
      "priority",
      "severity",
      "assignee",
      "label",
    ]);
  });
});

describe("computePivot — count crosstab (AC1, AC3)", () => {
  const issues = [
    makeIssue({ id: "R1", issue_type: "story", status: "todo" }),
    makeIssue({ id: "R2", issue_type: "story", status: "done" }),
    makeIssue({ id: "R3", issue_type: "bug", status: "todo" }),
    makeIssue({ id: "R4", issue_type: "task", status: "in_progress" }),
  ];

  it("buckets counts at the row/column intersection", () => {
    const r = computePivot(issues, "type", "status", LABELS);
    expect(pivotCell(r, "story", "todo")).toBe(1);
    expect(pivotCell(r, "story", "done")).toBe(1);
    expect(pivotCell(r, "task", "in_progress")).toBe(1);
    expect(pivotCell(r, "bug", "todo")).toBe(1);
    expect(r.max).toBe(1);
  });

  it("keeps fixed-enum order but drops fully-empty rows/columns", () => {
    const r = computePivot(issues, "type", "status", LABELS);
    // canonical type order is epic,story,task,bug,... — epic/spike/chore unused.
    expect(r.rows.map((a) => a.key)).toEqual(["story", "task", "bug"]);
    expect(r.rows.map((a) => a.label)).toEqual(["Story", "Task", "Bug"]);
    // canonical status order keeps todo<in_progress<done; backlog/closed unused.
    expect(r.cols.map((a) => a.key)).toEqual(["todo", "in_progress", "done"]);
    expect(r.cols.map((a) => a.label)).toEqual(["Todo", "In Progress", "Done"]);
  });

  it("reports a genuine zero for a pair that never co-occurred (empty cell)", () => {
    const r = computePivot(issues, "type", "status", LABELS);
    // story has todo + done but no in_progress.
    expect(pivotCell(r, "story", "in_progress")).toBe(0);
    expect(r.cells.get("story")?.has("in_progress")).toBe(false);
  });

  it("computes consistent row/column/grand totals", () => {
    const r = computePivot(issues, "type", "status", LABELS);
    expect(r.rowTotals.get("story")).toBe(2);
    expect(r.colTotals.get("todo")).toBe(2);
    expect(r.grandTotal).toBe(4);
    expectConsistentTotals(r);
  });
});

describe("computePivot — missing values become a None bucket", () => {
  it("folds a missing priority/severity into None, in canonical position", () => {
    const r = computePivot(
      [
        makeIssue({ id: "R1", priority: "critical" }),
        makeIssue({ id: "R2" }), // no priority
      ],
      "priority",
      "status",
      LABELS,
    );
    const labels = r.rows.map((a) => a.label);
    expect(labels).toContain("Critical");
    expect(labels).toContain("None");
    const noneKey = r.rows.find((a) => a.label === "None")?.key;
    expect(noneKey && r.rowTotals.get(noneKey)).toBe(1);
  });
});

describe("computePivot — dynamic axis ranking + Other fold", () => {
  const issues = [
    ...Array.from({ length: 5 }, (_, i) =>
      makeIssue({ id: `a${i}`, assigned_to: "alice" }),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      makeIssue({ id: `b${i}`, assigned_to: "bob" }),
    ),
    ...Array.from({ length: 3 }, (_, i) =>
      makeIssue({ id: `c${i}`, assigned_to: "carol" }),
    ),
    makeIssue({ id: "d0", assigned_to: "dave" }),
    makeIssue({ id: "d1", assigned_to: "dave" }),
    makeIssue({ id: "e0", assigned_to: "erin" }),
  ];

  it("ranks discovered buckets by count and folds the tail into Other", () => {
    const r = computePivot(issues, "assignee", "status", LABELS, {
      rowLimit: 3,
    });
    expect(r.rows.map((a) => a.label)).toEqual([
      "alice",
      "bob",
      "carol",
      "Other",
    ]);
    expect(r.rowsFolded).toBe(2); // dave + erin
    expect(r.rowTotals.get("alice")).toBe(5);
    const otherKey = r.rows[r.rows.length - 1].key;
    expect(r.rowTotals.get(otherKey)).toBe(3); // dave(2) + erin(1)
    expectConsistentTotals(r);
  });

  it("does not fold when the bucket count is within the cap", () => {
    const r = computePivot(issues, "assignee", "status", LABELS);
    expect(r.rowsFolded).toBe(0);
    expect(r.rows.some((a) => a.label === "Other")).toBe(false);
  });
});

describe("computePivot — multi-valued label axis", () => {
  // A labelled issue lands in one bucket per label, so totals count label
  // occurrences (an issue with two labels counts twice). Unlabeled issues get
  // their own bucket so the axis still represents the whole population.
  const issues = [
    makeIssue({ id: "L1", labels: ["bug", "ui"], status: "todo" }),
    makeIssue({ id: "L2", labels: ["bug"], status: "done" }),
    makeIssue({ id: "L3", labels: [], status: "todo" }),
  ];

  it("counts each label and an Unlabeled bucket, with occurrence totals", () => {
    const r = computePivot(issues, "label", "status", LABELS);
    expect(r.rows.map((a) => a.label).sort()).toEqual([
      "Unlabeled",
      "bug",
      "ui",
    ]);
    expect(pivotCell(r, "bug", "todo")).toBe(1);
    expect(pivotCell(r, "bug", "done")).toBe(1);
    expect(pivotCell(r, "ui", "todo")).toBe(1);
    expect(pivotCell(r, "Unlabeled", "todo")).toBe(1);
    expect(r.rowTotals.get("bug")).toBe(2);
    expect(r.grandTotal).toBe(4); // 2 (L1) + 1 (L2) + 1 (L3)
    expectConsistentTotals(r);
  });
});

describe("computePivot — population scope", () => {
  it("aggregates only issues that pass the report filters", () => {
    const issues = [
      makeIssue({ id: "R1", status: "todo", issue_type: "task" }),
      makeIssue({
        id: "R2",
        status: "todo",
        issue_type: "task",
        archived_at: "2026-05-01T00:00:00.000Z",
      }),
    ];
    // Default scope ("active") drops archived issues, like the other cards.
    const r = computePivot(issues, "status", "type", LABELS);
    expect(r.grandTotal).toBe(1);

    const allScope: ReportFilters = {
      period: "12w",
      scope: "all",
      measure: "count",
    };
    expect(
      computePivot(issues, "status", "type", LABELS, { filters: allScope })
        .grandTotal,
    ).toBe(2);
  });
});

describe("pivotCell", () => {
  it("returns 0 for an unknown pair", () => {
    const r = computePivot([makeIssue({ id: "R1" })], "status", "type", LABELS);
    expect(pivotCell(r, "nonexistent", "task")).toBe(0);
  });
});
