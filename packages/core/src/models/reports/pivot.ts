import type { IssueListItem } from "../../schemas/issues/metadata";
import {
  IssueTypeEnum,
  PriorityEnum,
  SeverityEnum,
  StatusEnum,
} from "../../schemas/issues/metadata";
import type {
  PivotAxis,
  PivotFieldKey,
  PivotResult,
  ReportFilters,
} from "../../schemas/reports";
import { DEFAULT_REPORT_FILTERS, matchesFilters } from "./aggregateModel";

export type {
  PivotAxis,
  PivotFieldKey,
  PivotResult,
} from "../../schemas/reports";

export const PIVOT_FIELD_KEYS: readonly PivotFieldKey[] = [
  "status",
  "type",
  "priority",
  "severity",
  "assignee",
  "label",
] as const;

const NONE_KEY = "\0none";
const OTHER_KEY = "\0other";

const FIXED_FIELDS: Partial<Record<PivotFieldKey, readonly string[]>> = {
  status: StatusEnum.options,
  type: IssueTypeEnum.options,
  priority: [...PriorityEnum.options, NONE_KEY],
  severity: [...SeverityEnum.options, NONE_KEY],
};

function valuesFor(issue: IssueListItem, field: PivotFieldKey): string[] {
  switch (field) {
    case "status":
      return [issue.status];
    case "type":
      return [issue.issue_type ?? "task"];
    case "priority":
      return [issue.priority ?? NONE_KEY];
    case "severity":
      return [issue.severity ?? NONE_KEY];
    case "assignee":
      return [issue.assigned_to?.trim() || "Unassigned"];
    case "label": {
      const labels = (issue.labels ?? [])
        .map((label) => label.trim())
        .filter(Boolean);
      return labels.length > 0 ? labels : ["Unlabeled"];
    }
  }
  return [];
}

function displaySortLabel(field: PivotFieldKey, key: string): string {
  if (key === OTHER_KEY) return "Other";
  if (field === "assignee" && key === "Unassigned") return "Unassigned";
  if (field === "label" && key === "Unlabeled") return "Unlabeled";
  if (key === NONE_KEY) return "None";
  return key;
}

function sortDynamic(
  field: PivotFieldKey,
  totals: ReadonlyMap<string, number>,
  limit: number,
): { axis: PivotAxis[]; foldedKeys: Set<string>; folded: number } {
  const ranked = Array.from(totals.entries())
    .map(([key, total]) => ({ key, total }))
    .sort(
      (a, b) =>
        b.total - a.total ||
        displaySortLabel(field, a.key).localeCompare(
          displaySortLabel(field, b.key),
        ),
    );
  const kept = ranked.slice(0, limit);
  const rest = ranked.slice(limit);
  const axis = kept.map(({ key }) => ({ key }));
  if (rest.length > 0) axis.push({ key: OTHER_KEY });
  return {
    axis,
    foldedKeys: new Set(rest.map((row) => row.key)),
    folded: rest.length,
  };
}

function buildAxis(
  field: PivotFieldKey,
  totals: ReadonlyMap<string, number>,
  limit: number,
): { axis: PivotAxis[]; foldedKeys: Set<string>; folded: number } {
  const fixed = FIXED_FIELDS[field];
  if (fixed) {
    return {
      axis: fixed
        .filter((key) => (totals.get(key) ?? 0) > 0)
        .map((key) => ({ key })),
      foldedKeys: new Set<string>(),
      folded: 0,
    };
  }
  return sortDynamic(field, totals, limit);
}

export interface PivotOptions {
  filters?: ReportFilters;
  rowLimit?: number;
  colLimit?: number;
}

export function pivotCell(
  result: PivotResult,
  rowKey: string,
  colKey: string,
): number {
  return (
    result.cells.find(
      (cell) => cell.rowKey === rowKey && cell.colKey === colKey,
    )?.count ?? 0
  );
}

export function pivotTotal(
  totals: ReadonlyArray<{ key: string; total: number }>,
  key: string,
): number {
  return totals.find((row) => row.key === key)?.total ?? 0;
}

export function computePivot(
  issues: ReadonlyArray<IssueListItem>,
  rowField: PivotFieldKey,
  colField: PivotFieldKey,
  options: PivotOptions = {},
): PivotResult {
  const {
    filters = DEFAULT_REPORT_FILTERS,
    rowLimit = 12,
    colLimit = 8,
  } = options;
  const counts = new Map<string, Map<string, number>>();
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  let grand = 0;

  for (const issue of issues) {
    if (!matchesFilters(issue, filters)) continue;
    const rowKeys = valuesFor(issue, rowField);
    const colKeys = valuesFor(issue, colField);
    for (const rowKey of rowKeys) {
      let row = counts.get(rowKey);
      if (!row) {
        row = new Map();
        counts.set(rowKey, row);
      }
      rowTotals.set(rowKey, (rowTotals.get(rowKey) ?? 0) + colKeys.length);
      for (const colKey of colKeys) {
        row.set(colKey, (row.get(colKey) ?? 0) + 1);
        grand++;
      }
    }
    for (const colKey of colKeys) {
      colTotals.set(colKey, (colTotals.get(colKey) ?? 0) + rowKeys.length);
    }
  }

  const row = buildAxis(rowField, rowTotals, rowLimit);
  const col = buildAxis(colField, colTotals, colLimit);
  const mapRow = (key: string) => (row.foldedKeys.has(key) ? OTHER_KEY : key);
  const mapCol = (key: string) => (col.foldedKeys.has(key) ? OTHER_KEY : key);
  const foldedCells = new Map<string, Map<string, number>>();
  let max = 0;
  for (const [rowKey, values] of counts) {
    const displayRow = mapRow(rowKey);
    let displayValues = foldedCells.get(displayRow);
    if (!displayValues) {
      displayValues = new Map();
      foldedCells.set(displayRow, displayValues);
    }
    for (const [colKey, value] of values) {
      const displayCol = mapCol(colKey);
      const next = (displayValues.get(displayCol) ?? 0) + value;
      displayValues.set(displayCol, next);
      if (next > max) max = next;
    }
  }

  const foldedRowTotals = new Map<string, number>();
  for (const [key, total] of rowTotals) {
    const displayKey = mapRow(key);
    foldedRowTotals.set(
      displayKey,
      (foldedRowTotals.get(displayKey) ?? 0) + total,
    );
  }
  const foldedColTotals = new Map<string, number>();
  for (const [key, total] of colTotals) {
    const displayKey = mapCol(key);
    foldedColTotals.set(
      displayKey,
      (foldedColTotals.get(displayKey) ?? 0) + total,
    );
  }

  return {
    rowField,
    colField,
    rows: row.axis,
    cols: col.axis,
    cells: Array.from(foldedCells, ([rowKey, values]) =>
      Array.from(values, ([colKey, count]) => ({ rowKey, colKey, count })),
    ).flat(),
    rowTotals: Array.from(foldedRowTotals, ([key, total]) => ({ key, total })),
    colTotals: Array.from(foldedColTotals, ([key, total]) => ({ key, total })),
    grandTotal: grand,
    max,
    rowsFolded: row.folded,
    colsFolded: col.folded,
  };
}
