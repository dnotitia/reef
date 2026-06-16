"use client";

import { cn } from "@/lib/utils";
import type {
  AgingBucketKey,
  RiskBucket,
  RiskPriority,
} from "../lib/aggregate";
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
