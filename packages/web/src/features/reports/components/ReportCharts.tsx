"use client";

import { formatTimestampMonthDay } from "@/features/issues/lib/dateHelpers";
import { usePriorityLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import type {
  AgingBucketKey,
  FlowMetricResult,
  RiskBucket,
  RiskPriority,
} from "../lib/aggregateModel";
import { type PivotAxis, type PivotResult, pivotCell } from "../lib/pivot";
import type { PivotFieldKey } from "../lib/pivot";
export { NetThroughputChart } from "./ThroughputCharts";

/**
 * Dependency-free SVG chart primitives for the reports dashboard. Kept local to
 * the reports feature to avoid adding a charting library for small, fixed
 * visualizations. All color inputs are CSS custom-property references
 * (`var(--brand-chart)`, ...) so charts inherit light/dark tokens automatically.
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
          // is not a single composited scaleX; drop the width transition
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
  emptyLabel,
}: {
  rows: ReadonlyArray<RankedBarRow>;
  emptyLabel?: string;
}) {
  const t = useTranslations("reports.page");
  const visible = rows.filter((row) => row.value > 0);
  const max = Math.max(...visible.map((row) => row.value), 1);

  if (visible.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {emptyLabel ?? t("noData")}
      </p>
    );
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
                animating width (a layout property). Gated on `motion-safe` so
                reduced-motion users get the final bar with no animation
                (REEF-097 AC3, REEF-248). */}
            <div
              className="h-full w-full origin-left rounded-full ease-out motion-safe:transition-transform motion-safe:duration-500"
              style={{
                transform: `scaleX(${Math.max(0.02, row.value / max)})`,
                backgroundColor: row.color ?? "var(--brand-chart)",
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

// ─── Count matrices (Risk map + Pivot) ───────────────────────────────────────
// Both the fixed Risk map and the custom Pivot are heat tables: a count rendered
// as text AND as cell intensity. They deliberately share ONE idiom — the same
// cell chrome (`HEAT_CELL`) and the same density ramp (`heatFill`) — so the two
// read as "the same kind of thing" (a crosstab), differentiated by their titles
// and axes, not by accidental styling drift (REEF-248).

const HEAT_CELL =
  "h-9 rounded-md border border-border-subtle bg-surface-hover text-center align-middle font-mono text-xs tabular-nums text-foreground";

/** Neutral density fill for a count cell. A single gray ramp — distinct from the
 *  brand-tinted value bars — so a heat cell does not compete with a quantity bar
 *  for the same color meaning (REEF-248). Empty cells return `undefined` to keep
 *  the base surface (no number) so a zero reads as "nothing here", not "low".
 *  Mixing toward `surface-subtle` keeps cells readable in both themes (the fill
 *  flips with the surface, the cell text stays `foreground`). */
function heatFill(count: number, max: number): string | undefined {
  if (count <= 0) return undefined;
  const intensity = 0.1 + (count / Math.max(max, 1)) * 0.32;
  return `color-mix(in oklab, var(--muted-foreground) ${Math.round(
    intensity * 100,
  )}%, var(--surface-subtle))`;
}

// The Risk map is a fixed 5×4 crosstab of open work by priority (rows) × time
// since last update (columns). A real <table> (matching the Pivot) so screen
// readers announce the priority/age a cell belongs to. Cells carry neutral
// density — the risk signal is the position (critical row, stalled column),
// not a red tint, so the heat does not re-encode "risk" on top of "attention"
// (REEF-248).
export function RiskMatrix({
  buckets,
}: {
  buckets: ReadonlyArray<RiskBucket>;
}) {
  // Reuse the core priority value labels (REEF-292) so the risk rows stay in
  // sync with the rest of the app; the extra "none" row and the aging
  // column labels are web-catalog copy (REEF-299). The cast mirrors
  // `fieldLabels.ts` — the `aging.{bucket}` key is built at runtime.
  const priorityLabels = usePriorityLabels();
  const t = useTranslations("reports") as unknown as (key: string) => string;
  const tCards = useTranslations("reports.cards");
  const priorityLabel = (priority: RiskPriority): string =>
    priority === "none" ? t("riskPriorityNone") : priorityLabels[priority];
  const agingLabel = (aging: AgingBucketKey): string => t(`aging.${aging}`);

  const max = Math.max(...buckets.map((b) => b.count), 1);
  const byKey = new Map(
    buckets.map((b) => [`${b.priority}:${b.aging}`, b.count] as const),
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-separate [border-spacing:6px]">
        <caption className="sr-only">{tCards("riskCaption")}</caption>
        <colgroup>
          <col className="w-[76px]" />
          {AGING_BUCKETS.map((aging) => (
            <col key={aging} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <td className="border-0 bg-transparent p-0" />
            {AGING_BUCKETS.map((aging) => (
              <th
                key={aging}
                scope="col"
                className="px-1 pb-0.5 text-center align-bottom text-[10px] font-normal uppercase tracking-wide text-muted-foreground"
              >
                {agingLabel(aging)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RISK_PRIORITIES.map((priority) => (
            <tr key={priority}>
              <th
                scope="row"
                className="text-left text-xs font-normal text-foreground/80"
              >
                {priorityLabel(priority)}
              </th>
              {AGING_BUCKETS.map((aging) => {
                const count = byKey.get(`${priority}:${aging}`) ?? 0;
                return (
                  <td
                    key={aging}
                    className={HEAT_CELL}
                    style={{ backgroundColor: heatFill(count, max) }}
                    title={`${priorityLabel(priority)} ${agingLabel(aging)}: ${count}`}
                  >
                    {count > 0 ? count : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── PivotMatrix ─────────────────────────────────────────────────────────────
// The user-driven generalization of the Risk map: an arbitrary categorical
// row × column crosstab (REEF-189). Shares the Risk map's heat idiom (HEAT_CELL
// + heatFill) on a single neutral scale, since an arbitrary pair has no hot/cool
// meaning. Headers stay plain text (no glyphs or uppercasing: assignee/label
// values are free text), and the trailing Total row/column are marginals, not
// heat cells.

export function PivotMatrix({
  result,
  fieldLabels,
}: {
  result: PivotResult;
  fieldLabels: Record<PivotFieldKey, string>;
}) {
  const { rows, cols, max } = result;
  const t = useTranslations("reports.cards");
  if (rows.length === 0 || cols.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("noDataToCrossTabulate")}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] table-fixed border-separate [border-spacing:6px]">
        <caption className="sr-only">
          {t("issueCountByCaption", {
            row: fieldLabels[result.rowField],
            col: fieldLabels[result.colField],
          })}
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
              {t("total")}
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
              {t("total")}
            </th>
            {cols.map((c) => (
              <td
                key={c.key}
                className={cn(
                  HEAT_CELL,
                  "border-border font-medium text-foreground",
                )}
              >
                {result.colTotals.get(c.key) ?? 0}
              </td>
            ))}
            <td
              className={cn(HEAT_CELL, "border-border font-semibold")}
              style={{
                backgroundColor:
                  "color-mix(in oklab, var(--muted-foreground) 12%, var(--surface-subtle))",
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
            className={HEAT_CELL}
            style={{ backgroundColor: heatFill(n, max) }}
            title={`${row.label} × ${c.label}: ${n}`}
          >
            {n > 0 ? n : ""}
          </td>
        );
      })}
      <td className={cn(HEAT_CELL, "border-border font-medium")}>
        {result.rowTotals.get(row.key) ?? 0}
      </td>
    </tr>
  );
}

export function FlowMetricsChart({
  result,
  metricLabel,
}: {
  result: FlowMetricResult;
  metricLabel: string;
}) {
  const locale = useLocale();
  const t = useTranslations("reports.cards");
  const percentiles = result.percentiles;
  if (!percentiles || result.points.length === 0) return null;

  const W = 640;
  const H = 260;
  const padLeft = 48;
  const padRight = 12;
  const padTop = 20;
  const padBottom = 42;
  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;
  const times = result.points.map((point) => Date.parse(point.completionAt));
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeRange = maxTime - minTime;
  const maxValue = Math.max(
    1,
    percentiles.p95,
    ...result.points.map((point) => point.elapsedDays),
  );
  const yMax = maxValue * 1.1;
  const outlierIds = new Set(result.outliers.map((point) => point.issueId));
  const x = (time: number, index: number): number =>
    timeRange === 0
      ? padLeft +
        (result.points.length <= 1
          ? innerW / 2
          : (index / (result.points.length - 1)) * innerW)
      : padLeft + ((time - minTime) / timeRange) * innerW;
  const y = (value: number): number =>
    padTop + innerH - (value / yMax) * innerH;
  const yTicks = [0, yMax / 2, yMax];
  const percentileLines = [
    {
      key: "p50",
      value: percentiles.p50,
      color: "var(--status-in-progress-chart)",
    },
    {
      key: "p85",
      value: percentiles.p85,
      color: "var(--status-in-review-chart)",
    },
    { key: "p95", value: percentiles.p95, color: "var(--destructive-chart)" },
  ] as const;
  const tickIndexes = [
    ...new Set([
      0,
      Math.floor((result.points.length - 1) / 2),
      result.points.length - 1,
    ]),
  ];

  return (
    <div className="flex flex-col gap-2">
      <svg
        data-testid="flow-metrics-chart"
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={t("flowChartAria", { metric: metricLabel })}
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={padLeft}
              x2={W - padRight}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--border-subtle)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={padLeft - 8}
              y={y(tick) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {formatFlowDays(tick, locale)}
            </text>
          </g>
        ))}
        <line
          x1={padLeft}
          x2={W - padRight}
          y1={padTop + innerH}
          y2={padTop + innerH}
          stroke="var(--border)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {percentileLines.map((line) => (
          <g key={line.key}>
            <line
              x1={padLeft}
              x2={W - padRight}
              y1={y(line.value)}
              y2={y(line.value)}
              stroke={line.color}
              strokeDasharray={line.key === "p85" ? "5 3" : "3 3"}
              strokeWidth={line.key === "p85" ? 2 : 1.25}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={W - padRight - 2}
              y={y(line.value) - 4}
              textAnchor="end"
              className="fill-foreground text-[10px] font-medium"
            >
              {t(line.key)}
            </text>
          </g>
        ))}
        {result.points.map((point, index) => {
          const isOutlier = outlierIds.has(point.issueId);
          return (
            <circle
              key={`${point.issueId}-${point.completionAt}`}
              data-testid="flow-metric-point"
              data-outlier={isOutlier ? "true" : undefined}
              cx={x(times[index] ?? minTime, index)}
              cy={y(point.elapsedDays)}
              r={isOutlier ? 4.5 : 3.5}
              fill={
                isOutlier ? "var(--destructive-chart)" : "var(--brand-chart)"
              }
              stroke="var(--surface-card)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            >
              <title>
                {t("flowPointTooltip", {
                  id: point.issueId,
                  days: formatFlowDays(point.elapsedDays, locale),
                })}
              </title>
            </circle>
          );
        })}
        {tickIndexes.map((index) => {
          const point = result.points[index];
          if (!point) return null;
          return (
            <text
              key={`${point.issueId}-tick`}
              x={x(times[index] ?? minTime, index)}
              y={H - 20}
              textAnchor={
                index === 0
                  ? "start"
                  : index === result.points.length - 1
                    ? "end"
                    : "middle"
              }
              className="fill-muted-foreground text-[10px]"
            >
              {formatTimestampMonthDay(point.completionAt, locale) ?? ""}
            </text>
          );
        })}
        <text
          x={W / 2}
          y={H - 3}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          {t("completionTimeAxis")}
        </text>
        <text
          x={12}
          y={padTop + innerH / 2}
          textAnchor="middle"
          transform={`rotate(-90 12 ${padTop + innerH / 2})`}
          className="fill-muted-foreground text-[10px]"
        >
          {t("elapsedDaysAxis")}
        </text>
      </svg>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {percentileLines.map((line) => (
          <li key={line.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4"
              style={{
                backgroundColor: line.color,
                borderTop:
                  line.key === "p85" ? `2px dashed ${line.color}` : undefined,
              }}
            />
            <span>{t(line.key)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatFlowDays(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}
