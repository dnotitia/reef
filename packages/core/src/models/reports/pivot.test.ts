// @vitest-environment node

import type { IssueMetadata } from "../../schemas/issues/metadata";
import { PivotResultSchema, type ReportFilters } from "../../schemas/reports";
import { describe, expect, it } from "vitest";
import { PIVOT_FIELD_KEYS, computePivot, pivotCell, pivotTotal } from "./pivot";

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

const sumTotals = (totals: ReadonlyArray<{ total: number }>) =>
  totals.reduce((sum, row) => sum + row.total, 0);

const sumCells = (result: ReturnType<typeof computePivot>) =>
  result.cells.reduce((sum, cell) => sum + cell.count, 0);

function expectConsistentTotals(result: ReturnType<typeof computePivot>): void {
  expect(sumTotals(result.rowTotals)).toBe(result.grandTotal);
  expect(sumTotals(result.colTotals)).toBe(result.grandTotal);
  expect(sumCells(result)).toBe(result.grandTotal);
}

describe("computePivot", () => {
  it("offers the six categorical issue fields", () => {
    expect(PIVOT_FIELD_KEYS).toEqual([
      "status",
      "type",
      "priority",
      "severity",
      "assignee",
      "label",
    ]);
  });

  it("computes a count crosstab with canonical fixed-axis order", () => {
    const issues = [
      makeIssue({ id: "R1", issue_type: "story", status: "todo" }),
      makeIssue({ id: "R2", issue_type: "story", status: "done" }),
      makeIssue({ id: "R3", issue_type: "bug", status: "todo" }),
      makeIssue({ id: "R4", issue_type: "task", status: "in_progress" }),
    ];
    const result = computePivot(issues, "type", "status");

    expect(pivotCell(result, "story", "todo")).toBe(1);
    expect(pivotCell(result, "story", "done")).toBe(1);
    expect(pivotCell(result, "task", "in_progress")).toBe(1);
    expect(pivotCell(result, "story", "in_progress")).toBe(0);
    expect(result.rows.map((axis) => axis.key)).toEqual([
      "story",
      "task",
      "bug",
    ]);
    expect(result.cols.map((axis) => axis.key)).toEqual([
      "todo",
      "in_progress",
      "done",
    ]);
    expect(pivotTotal(result.rowTotals, "story")).toBe(2);
    expect(pivotTotal(result.colTotals, "todo")).toBe(2);
    expect(result.grandTotal).toBe(4);
    expectConsistentTotals(result);
  });

  it("keeps absent priority and severity values in the None bucket", () => {
    const result = computePivot(
      [makeIssue({ id: "R1", priority: "critical" }), makeIssue({ id: "R2" })],
      "priority",
      "status",
    );
    expect(result.rows.map((axis) => axis.key)).toEqual(["critical", "\0none"]);
    expect(pivotTotal(result.rowTotals, "\0none")).toBe(1);
  });

  it("ranks dynamic buckets and folds the tail into Other", () => {
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
    const result = computePivot(issues, "assignee", "status", {
      rowLimit: 3,
    });
    expect(result.rows.map((axis) => axis.key)).toEqual([
      "alice",
      "bob",
      "carol",
      "\0other",
    ]);
    expect(result.rowsFolded).toBe(2);
    expect(pivotTotal(result.rowTotals, "alice")).toBe(5);
    expect(pivotTotal(result.rowTotals, "\0other")).toBe(3);
    expectConsistentTotals(result);
  });

  it("counts every value on the multi-valued label axis", () => {
    const result = computePivot(
      [
        makeIssue({ id: "L1", labels: ["bug", "ui"], status: "todo" }),
        makeIssue({ id: "L2", labels: ["bug"], status: "done" }),
        makeIssue({ id: "L3", labels: [], status: "todo" }),
      ],
      "label",
      "status",
    );
    expect(result.rows.map((axis) => axis.key).sort()).toEqual([
      "Unlabeled",
      "bug",
      "ui",
    ]);
    expect(pivotCell(result, "bug", "todo")).toBe(1);
    expect(pivotCell(result, "bug", "done")).toBe(1);
    expect(pivotCell(result, "Unlabeled", "todo")).toBe(1);
    expect(pivotTotal(result.rowTotals, "bug")).toBe(2);
    expect(result.grandTotal).toBe(4);
    expectConsistentTotals(result);
  });

  it("uses shared report population filters", () => {
    const issues = [
      makeIssue({ id: "R1", status: "todo" }),
      makeIssue({
        id: "R2",
        status: "todo",
        archived_at: "2026-05-01T00:00:00.000Z",
      }),
    ];
    expect(computePivot(issues, "status", "type").grandTotal).toBe(1);
    const allScope: ReportFilters = {
      period: "12w",
      scope: "all",
      measure: "count",
    };
    expect(
      computePivot(issues, "status", "type", { filters: allScope }).grandTotal,
    ).toBe(2);
  });

  it("returns a JSON-safe result accepted by the response schema", () => {
    const result = computePivot(
      [makeIssue({ id: "R1", assigned_to: "__proto__" })],
      "assignee",
      "status",
    );
    const parsed = PivotResultSchema.parse(JSON.parse(JSON.stringify(result)));
    expect(parsed).toEqual(result);
    expect(pivotCell(result, "missing", "todo")).toBe(0);
  });
});
