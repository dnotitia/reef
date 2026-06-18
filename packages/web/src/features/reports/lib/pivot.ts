import { PRIORITY_OPTIONS } from "@/components/ui/priority-dot";
import { STATUS_OPTIONS } from "@/components/ui/status-icon";
import type {
  IssueListItem,
  IssueType,
  Priority,
  Severity,
  Status,
} from "@reef/core";
import {
  ISSUE_TYPE_LABELS,
  PRIORITY_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS,
} from "@reef/core/fields";
import {
  DEFAULT_REPORT_FILTERS,
  ISSUE_TYPE_OPTIONS,
  type ReportFilters,
  SEVERITY_OPTIONS,
  matchesFilters,
} from "./aggregateModel";

/**
 * Count-based 2-D pivot (crosstab) over the report population (REEF-189).
 *
 * Generalizes the fixed Risk map (severity x last-update) into a card where the
 * PM picks any two categorical fields for the rows and columns. The population
 * is the same `matchesFilters` set the in-scope distribution cards aggregate
 * over, so the pivot reads the active scope/facets identically. Measure is
 * consistently issue count here — story points are REEF-188's territory and are out of
 * this issue's scope.
 */

export type PivotFieldKey =
  | "status"
  | "type"
  | "priority"
  | "severity"
  | "assignee"
  | "label";

/** The fields offered as pivot axes — the existing categorical issue fields
 *  (REEF-189 AC2). */
export const PIVOT_FIELD_KEYS: readonly PivotFieldKey[] = [
  "status",
  "type",
  "priority",
  "severity",
  "assignee",
  "label",
] as const;

/** Picker labels for the row/column field selectors. */
export const PIVOT_FIELD_LABELS: Record<PivotFieldKey, string> = {
  status: "Status",
  type: "Type",
  priority: "Priority",
  severity: "Severity",
  assignee: "Assignee",
  label: "Label",
};

/** Sentinel keys kept out of the `string` value space so a real assignee or
 *  label literally named "None"/"Other" doesn't collide with a bucket. */
const NONE_KEY = "\0none";
const OTHER_KEY = "\0other";

export interface PivotAxis {
  /** Stable bucket key (an enum value, a raw name, or a sentinel). */
  key: string;
  /** Human-readable header label. */
  label: string;
}

interface PivotField {
  /** Bucket key(s) an issue falls into on this axis — consistently at least one. A
   *  multi-valued field (label) returns several, so one issue lands in several
   *  buckets and the totals then count occurrences, not issues. */
  valuesFor(issue: IssueListItem): string[];
  /** Pre-ordered axis for fixed enums; `null` for fields whose value set is
   *  discovered from the data and ranked (assignee/label). */
  fixed: readonly PivotAxis[] | null;
  /** Display label for a discovered/sentinel key. */
  labelFor(key: string): string;
}

const fixedAxis = <T extends string>(
  options: readonly T[],
  labels: Record<T, string>,
  extra?: PivotAxis,
): PivotAxis[] => {
  const base = options.map((key) => ({ key, label: labels[key] }));
  return extra ? [...base, extra] : base;
};

const PIVOT_FIELDS: Record<PivotFieldKey, PivotField> = {
  status: {
    valuesFor: (i) => [i.status],
    fixed: fixedAxis(STATUS_OPTIONS, STATUS_LABELS),
    labelFor: (k) => STATUS_LABELS[k as Status] ?? k,
  },
  type: {
    // Mirror the distribution cards: a missing issue_type reads as "task" so the
    // pivot population matches the active-issue count (aggregate.ts).
    valuesFor: (i) => [i.issue_type ?? "task"],
    fixed: fixedAxis(ISSUE_TYPE_OPTIONS, ISSUE_TYPE_LABELS),
    labelFor: (k) => ISSUE_TYPE_LABELS[k as IssueType] ?? k,
  },
  priority: {
    valuesFor: (i) => [i.priority ?? NONE_KEY],
    fixed: fixedAxis(PRIORITY_OPTIONS, PRIORITY_LABELS, {
      key: NONE_KEY,
      label: "None",
    }),
    labelFor: (k) =>
      k === NONE_KEY ? "None" : (PRIORITY_LABELS[k as Priority] ?? k),
  },
  severity: {
    valuesFor: (i) => [i.severity ?? NONE_KEY],
    fixed: fixedAxis(SEVERITY_OPTIONS, SEVERITY_LABELS, {
      key: NONE_KEY,
      label: "None",
    }),
    labelFor: (k) =>
      k === NONE_KEY ? "None" : (SEVERITY_LABELS[k as Severity] ?? k),
  },
  assignee: {
    valuesFor: (i) => [i.assigned_to?.trim() || "Unassigned"],
    fixed: null,
    labelFor: (k) => k,
  },
  label: {
    valuesFor: (i) => {
      const names = (i.labels ?? []).map((l) => l.trim()).filter(Boolean);
      return names.length > 0 ? names : ["Unlabeled"];
    },
    fixed: null,
    labelFor: (k) => k,
  },
};

export interface PivotOptions {
  /** Population filter — defaults to the report baseline, exactly as the
   *  distribution cards do. */
  filters?: ReportFilters;
  /** Max discovered row buckets before the rest fold into "Other". */
  rowLimit?: number;
  /** Max discovered column buckets before the rest fold into "Other"
   *  (tighter than rows since columns are width-bound). */
  colLimit?: number;
}

export interface PivotResult {
  rowField: PivotFieldKey;
  colField: PivotFieldKey;
  /** Ordered row axis (zero-total buckets dropped; trailing "Other" if folded). */
  rows: PivotAxis[];
  cols: PivotAxis[];
  /** rowKey -> colKey -> count. A missing entry is a genuine zero (empty cell). */
  cells: ReadonlyMap<string, ReadonlyMap<string, number>>;
  rowTotals: ReadonlyMap<string, number>;
  colTotals: ReadonlyMap<string, number>;
  grandTotal: number;
  /** Largest single data cell — the heat-scale denominator. Excludes totals. */
  max: number;
  /** Discovered buckets folded into the trailing "Other" (0 for fixed axes or
   *  when within the cap). Surfaced so the card can disclose the cap rather than
   *  silently truncate. */
  rowsFolded: number;
  colsFolded: number;
}

/** Count in a display cell, or 0 when the pair has not co-occurred. */
export function pivotCell(
  result: PivotResult,
  rowKey: string,
  colKey: string,
): number {
  return result.cells.get(rowKey)?.get(colKey) ?? 0;
}

function rankDynamic(
  totals: ReadonlyMap<string, number>,
  labelFor: (key: string) => string,
  limit: number,
): { axis: PivotAxis[]; foldedKeys: Set<string>; folded: number } {
  const ranked = Array.from(totals.entries())
    .map(([key, total]) => ({ key, total, label: labelFor(key) }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const kept = ranked.slice(0, limit);
  const rest = ranked.slice(limit);
  const axis = kept.map(({ key, label }) => ({ key, label }));
  if (rest.length > 0) axis.push({ key: OTHER_KEY, label: "Other" });
  return {
    axis,
    foldedKeys: new Set(rest.map((r) => r.key)),
    folded: rest.length,
  };
}

function buildAxis(
  field: PivotField,
  totals: ReadonlyMap<string, number>,
  limit: number,
): { axis: PivotAxis[]; foldedKeys: Set<string>; folded: number } {
  if (field.fixed) {
    // Fixed enums keep their canonical order but drop fully-empty buckets, so a
    // crosstab does not show an all-zero row/column for a type nobody uses — the
    // same noise byType filters out. Empty *cells* inside a populated row still
    // render (REEF-189 AC3).
    return {
      axis: field.fixed.filter((a) => (totals.get(a.key) ?? 0) > 0),
      foldedKeys: new Set<string>(),
      folded: 0,
    };
  }
  return rankDynamic(totals, field.labelFor, limit);
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
  const rowF = PIVOT_FIELDS[rowField];
  const colF = PIVOT_FIELDS[colField];

  // Single pass over the in-scope population (the distribution-card set).
  const counts = new Map<string, Map<string, number>>();
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  let grand = 0;
  for (const issue of issues) {
    if (!matchesFilters(issue, filters)) continue;
    const rowKeys = rowF.valuesFor(issue);
    const colKeys = colF.valuesFor(issue);
    for (const r of rowKeys) {
      let inner = counts.get(r);
      if (!inner) {
        inner = new Map();
        counts.set(r, inner);
      }
      rowTotals.set(r, (rowTotals.get(r) ?? 0) + colKeys.length);
      for (const c of colKeys) {
        inner.set(c, (inner.get(c) ?? 0) + 1);
        grand += 1;
      }
    }
    for (const c of colKeys) {
      colTotals.set(c, (colTotals.get(c) ?? 0) + rowKeys.length);
    }
  }

  const row = buildAxis(rowF, rowTotals, rowLimit);
  const col = buildAxis(colF, colTotals, colLimit);
  const mapRow = (k: string) => (row.foldedKeys.has(k) ? OTHER_KEY : k);
  const mapCol = (k: string) => (col.foldedKeys.has(k) ? OTHER_KEY : k);

  // Collapse folded buckets into their "Other" lane (rows, columns, and the
  // Other x Other corner all fold through the same key remap).
  const cells = new Map<string, Map<string, number>>();
  let max = 0;
  for (const [r, inner] of counts) {
    const dr = mapRow(r);
    let outRow = cells.get(dr);
    if (!outRow) {
      outRow = new Map();
      cells.set(dr, outRow);
    }
    for (const [c, n] of inner) {
      const dc = mapCol(c);
      const next = (outRow.get(dc) ?? 0) + n;
      outRow.set(dc, next);
      if (next > max) max = next;
    }
  }
  const dispRowTotals = new Map<string, number>();
  for (const [r, t] of rowTotals) {
    const dr = mapRow(r);
    dispRowTotals.set(dr, (dispRowTotals.get(dr) ?? 0) + t);
  }
  const dispColTotals = new Map<string, number>();
  for (const [c, t] of colTotals) {
    const dc = mapCol(c);
    dispColTotals.set(dc, (dispColTotals.get(dc) ?? 0) + t);
  }

  return {
    rowField,
    colField,
    rows: row.axis,
    cols: col.axis,
    cells,
    rowTotals: dispRowTotals,
    colTotals: dispColTotals,
    grandTotal: grand,
    max,
    rowsFolded: row.folded,
    colsFolded: col.folded,
  };
}
