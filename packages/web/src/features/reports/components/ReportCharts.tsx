"use client";

import { cn } from "@/lib/utils";
import type {
  AgingBucketKey,
  RiskBucket,
  RiskPriority,
} from "../lib/aggregate";
import { type PivotAxis, type PivotResult, pivotCell } from "../lib/pivot";
export { NetThroughputChart } from "./ThroughputCharts";

/**
 * Dependency-free SVG chart primitives for the reports dashboard. Kept local to
 * the reports feature to avoid adding a charting library for small, fixed
 * visualizations. All color inputs are CSS custom-property references
 * (`var(--brand)`, ...) so charts inherit light/dark tokens automatically.
 */

export interface Segment {
  key: string;
  label: string;
  value: number;
  /** A CSS color value, typically `var(--token)`. */
  color: string;
}

// ─── SegmentedBar ────────────────────────────────────────────────────────────
// A single horizontal bar split into proportional segments — the workflow
// "funnel" / distribution at a glance. Zero-value segments are dropped.

export function SegmentedBar({
  segments,
  className,
}: {
  segments: ReadonlyArray<Segment>;
  className?: string;
}) {
  const visible = segments.filter((s) => s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0) || 1;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-hover">
        {visible.map((s) => (
          // Segment widths position one another in flow, so this proportion bar
          // does not be a single composited scaleX; drop the width transition
          // rather than animate a layout property. (REEF-097 AC3)
          <div
            key={s.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${(s.value / total) * 100}%`,
              backgroundColor: s.color,
            }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {visible.map((s) => (
          <li
            key={s.key}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-[3px]"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-foreground/80">{s.label}</span>
            <span className="font-mono tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface RankedBarRow {
  key: string;
  label: string;
  value: number;
  color?: string;
}

export function RankedBarList({
  rows,
  emptyLabel = "No data in this category.",
}: {
  rows: ReadonlyArray<RankedBarRow>;
  emptyLabel?: string;
}) {
  const visible = rows.filter((row) => row.value > 0);
  const max = Math.max(...visible.map((row) => row.value), 1);

  if (visible.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {visible.map((row) => (
        <li
          key={row.key}
          className="grid grid-cols-[124px_1fr_40px] items-center gap-3"
        >
          <span
            className="truncate text-xs text-foreground/90"
            title={row.label}
          >
            {row.label}
          </span>
          <div
            aria-hidden="true"
            className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
          >
            {/* Composited grow-in: scaleX off a full-width track instead of
                animating width (a layout property). (REEF-097 AC3) */}
            <div
              className="h-full w-full origin-left rounded-full transition-transform duration-500 ease-out"
              style={{
                transform: `scaleX(${Math.max(0.02, row.value / max)})`,
                backgroundColor: row.color ?? "var(--brand)",
                opacity: row.color ? 0.85 : 0.7,
              }}
            />
          </div>
          <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
            {row.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

const RISK_PRIORITY_LABELS: Record<RiskPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "None",
};

const AGING_LABELS: Record<AgingBucketKey, string> = {
  fresh: "<1w",
  recent: "1-2w",
  stale: "2-4w",
  stalled: ">4w",
};

const RISK_PRIORITIES: readonly RiskPriority[] = [
  "critical",
  "high",
  "medium",
  "low",
  "none",
] as const;

const AGING_BUCKETS: readonly AgingBucketKey[] = [
  "fresh",
  "recent",
  "stale",
  "stalled",
] as const;

export function RiskMatrix({
  buckets,
}: {
  buckets: ReadonlyArray<RiskBucket>;
}) {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const byKey = new Map(
    buckets.map((b) => [`${b.priority}:${b.aging}`, b.count] as const),
  );

  return (
    <div className="grid grid-cols-[76px_repeat(4,minmax(0,1fr))] gap-1.5">
      <span aria-hidden="true" />
      {AGING_BUCKETS.map((aging) => (
        <span
          key={aging}
          className="text-center text-[10px] uppercase tracking-wide text-muted-foreground"
        >
          {AGING_LABELS[aging]}
        </span>
      ))}
      {RISK_PRIORITIES.map((priority) => (
        <MatrixRow
          key={priority}
          priority={priority}
          max={max}
          counts={AGING_BUCKETS.map(
            (aging) => byKey.get(`${priority}:${aging}`) ?? 0,
          )}
        />
      ))}
    </div>
  );
}

function MatrixRow({
  priority,
  counts,
  max,
}: {
  priority: RiskPriority;
  counts: ReadonlyArray<number>;
  max: number;
}) {
  return (
    <>
      <span className="flex items-center text-xs text-foreground/80">
        {RISK_PRIORITY_LABELS[priority]}
      </span>
      {counts.map((count, index) => {
        const intensity = count === 0 ? 0 : 0.1 + (count / max) * 0.5;
        const aging = AGING_BUCKETS[index];
        const hot =
          priority === "critical" ||
          priority === "high" ||
          aging === "stale" ||
          aging === "stalled";
        return (
          <div
            key={`${priority}-${aging}`}
            className="flex h-9 items-center justify-center rounded-md border border-border-subtle bg-surface-hover font-mono text-xs tabular-nums"
            style={{
              backgroundColor:
                count > 0
                  ? `color-mix(in oklab, ${
                      hot ? "var(--destructive)" : "var(--brand)"
                    } ${Math.round(intensity * 100)}%, var(--surface-subtle))`
                  : undefined,
            }}
            title={`${RISK_PRIORITY_LABELS[priority]} ${AGING_LABELS[aging]}: ${count}`}
          >
            {count > 0 ? count : ""}
          </div>
        );
      })}
    </>
  );
}

// ─── PivotMatrix ─────────────────────────────────────────────────────────────
// The user-driven generalization of the Risk map: an arbitrary categorical
// row x column crosstab (REEF-189). A real <table> (the Risk map's flat grid is
// a fixed 5x4 with no header semantics) so screen readers announce the row/
// column a cell belongs to. Cells re-use the Risk map's heat idiom — count both
// as text and as brand intensity — but on a single neutral scale, since an
// arbitrary pair has no hot/cool meaning. Headers stay plain text (no glyphs or
// uppercasing: assignee/label values are free text), and the trailing Total
// row/column are marginals, not heat cells.

const PIVOT_CELL =
  "h-9 rounded-md border border-border-subtle bg-surface-hover text-center align-middle font-mono text-xs tabular-nums text-foreground";

function pivotHeat(count: number, max: number): string | undefined {
  // Empty cells keep the neutral base fill (no number, just the box) so a zero
  // reads as "no work here", not "low" (REEF-189 AC3). Same ramp as the Risk
  // map, always brand.
  if (count <= 0) return undefined;
  const intensity = 0.1 + (count / Math.max(max, 1)) * 0.5;
  return `color-mix(in oklab, var(--brand) ${Math.round(
    intensity * 100,
  )}%, var(--surface-subtle))`;
}

export function PivotMatrix({ result }: { result: PivotResult }) {
  const { rows, cols, max } = result;
  if (rows.length === 0 || cols.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No data to cross-tabulate.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] table-fixed border-separate [border-spacing:6px]">
        <caption className="sr-only">
          Issue count by {result.rowField} (rows) and {result.colField}
          (columns).
        </caption>
        <colgroup>
          <col className="w-[120px]" />
          {cols.map((c) => (
            <col key={c.key} />
          ))}
          <col className="w-[56px]" />
        </colgroup>
        <thead>
          <tr>
            <td className="border-0 bg-transparent p-0" />
            {cols.map((c) => (
              <th
                key={c.key}
                scope="col"
                title={c.label}
                className="truncate px-1 pb-0.5 text-center align-bottom text-[11px] font-normal text-muted-foreground"
              >
                {c.label}
              </th>
            ))}
            <th
              scope="col"
              className="px-1 pb-0.5 text-center align-bottom text-[11px] font-semibold text-foreground"
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <PivotRow
              key={row.key}
              row={row}
              cols={cols}
              result={result}
              max={max}
            />
          ))}
          <tr>
            <th
              scope="row"
              className="truncate text-left text-xs font-semibold text-foreground"
            >
              Total
            </th>
            {cols.map((c) => (
              <td
                key={c.key}
                className={cn(
                  PIVOT_CELL,
                  "border-border font-medium text-foreground",
                )}
              >
                {result.colTotals.get(c.key) ?? 0}
              </td>
            ))}
            <td
              className={cn(PIVOT_CELL, "border-border font-semibold")}
              style={{
                backgroundColor:
                  "color-mix(in oklab, var(--brand) 14%, var(--surface-subtle))",
              }}
            >
              {result.grandTotal}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PivotRow({
  row,
  cols,
  result,
  max,
}: {
  row: PivotAxis;
  cols: ReadonlyArray<PivotAxis>;
  result: PivotResult;
  max: number;
}) {
  return (
    <tr>
      <th
        scope="row"
        title={row.label}
        className="truncate text-left text-xs font-normal text-foreground/80"
      >
        {row.label}
      </th>
      {cols.map((c) => {
        const n = pivotCell(result, row.key, c.key);
        return (
          <td
            key={c.key}
            className={PIVOT_CELL}
            style={{ backgroundColor: pivotHeat(n, max) }}
            title={`${row.label} × ${c.label}: ${n}`}
          >
            {n > 0 ? n : ""}
          </td>
        );
      })}
      <td className={cn(PIVOT_CELL, "border-border font-medium")}>
        {result.rowTotals.get(row.key) ?? 0}
      </td>
    </tr>
  );
}
