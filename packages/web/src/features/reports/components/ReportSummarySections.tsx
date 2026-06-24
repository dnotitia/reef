"use client";

import { useStatusLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import { type IssueType, type Status, isResolvedStatus } from "@reef/core";
import type {
  NamedCount,
  ReportAggregates,
  ReportMeasure,
  StatusCount,
} from "../lib/aggregate";
import { type Segment, SegmentedBar } from "./ReportCharts";
import { Card } from "./ReportLayout";

const STATUS_COLOR: Record<Status, string> = {
  backlog: "var(--status-backlog)",
  // `todo` keeps the shared `--status-open` token (REEF-139).
  todo: "var(--status-open)",
  in_progress: "var(--status-in-progress)",
  in_review: "var(--status-in-review)",
  done: "var(--status-done)",
  closed: "var(--status-closed)",
};

// By type carries labels: its bars are the same neutral brand value-bars as
// By severity / Top assignees / Top labels, so the four breakdown cards read as
// one idiom. A per-type fill would re-encode the identity the row label
// already names (the REEF-186 argument for neutral severity bars), and it leaked
// brand / priority / status tokens into a card that means none of them
// (REEF-248).
export const TYPE_META: Record<IssueType, { label: string }> = {
  epic: { label: "Epic" },
  story: { label: "Story" },
  task: { label: "Task" },
  bug: { label: "Bug" },
  spike: { label: "Spike" },
  chore: { label: "Chore" },
};

export function HealthSummary({ agg }: { agg: ReportAggregates }) {
  const { kpis, total, riskSummary } = agg;
  // Completion %, net throughput, and the in-review count each live in a single
  // home elsewhere (the Workflow "Completion" header, the Throughput card
  // subtitle, and the workflow funnel legend); the KPI grid no longer echoes
  // them (REEF-192).
  const tiles: ReadonlyArray<{
    key: string;
    label: string;
    value: number | string;
    tone?: "default" | "warn" | "danger" | "quiet";
    hint?: string;
  }> = [
    {
      key: "at-risk",
      label: "At risk",
      value: riskSummary.atRisk,
      tone: riskSummary.atRisk > 0 ? "danger" : "default",
      hint: `${riskSummary.critical} critical`,
    },
    {
      key: "overdue",
      label: "Overdue",
      value: riskSummary.overdue,
      tone: riskSummary.overdue > 0 ? "danger" : "default",
    },
    {
      key: "stale",
      label: "Stale",
      value: riskSummary.stale,
      tone: riskSummary.stale > 0 ? "warn" : "default",
    },
    {
      key: "blocked",
      label: "Blocked",
      value: riskSummary.blocked,
      tone: riskSummary.blocked > 0 ? "warn" : "default",
    },
    {
      key: "active",
      label: "Active",
      value: total,
      tone: "quiet",
    },
    {
      key: "in-progress",
      label: "In progress",
      value: kpis.inProgress,
      tone: "quiet",
    },
    {
      key: "done",
      label: "Done",
      value: kpis.done,
      tone: "quiet",
    },
    {
      key: "unassigned",
      label: "Unassigned",
      value: kpis.unassigned,
      tone: "quiet",
    },
  ];

  return (
    <ul
      data-testid="reports-kpis"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
    >
      {tiles.map((t) => (
        <li
          key={t.key}
          data-testid={`kpi-${t.key}`}
          className={cn(
            "relative flex flex-col gap-1 overflow-hidden rounded-lg border border-border-subtle bg-surface-subtle p-3",
            "min-h-[76px] justify-between",
            t.tone === "danger" &&
              "border-destructive/25 bg-destructive/[0.035] pl-4",
            t.tone === "warn" && "pl-4",
            t.tone === "quiet" && "opacity-75",
          )}
        >
          {(t.tone === "danger" || t.tone === "warn") && (
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-y-0 left-0 w-1",
                t.tone === "danger" ? "bg-destructive" : "bg-priority-high",
              )}
            />
          )}
          <span className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
            {t.label}
          </span>
          <span className="flex min-w-0 items-end justify-between gap-2">
            <span
              className={cn(
                "shrink-0 font-mono text-2xl font-semibold tabular-nums leading-none",
                t.tone === "danger" && "text-destructive",
                t.tone === "warn" && "text-priority-high",
              )}
            >
              {t.value}
            </span>
            {t.hint && (
              <span className="truncate text-right text-[11px] font-medium text-muted-foreground">
                {t.hint}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StatusFunnel({
  rows,
  measure = "count",
}: {
  rows: ReadonlyArray<StatusCount>;
  measure?: ReportMeasure;
}) {
  const statusLabels = useStatusLabels();
  // Completion / WIP are ratios of the *active measure* so the funnel header
  // stays internally consistent when points-weighted (rows already hold both,
  // and done+closed counts equal the old kpis.done — REEF-188).
  const value = (r: StatusCount) => (measure === "points" ? r.points : r.count);
  const total = rows.reduce((sum, r) => sum + value(r), 0);
  const doneTotal = rows
    .filter((r) => isResolvedStatus(r.status))
    .reduce((sum, r) => sum + value(r), 0);
  const wipTotal = rows
    .filter((r) => r.status === "in_progress" || r.status === "in_review")
    .reduce((sum, r) => sum + value(r), 0);
  const completion = total > 0 ? Math.round((doneTotal / total) * 100) : 0;
  const wip = total > 0 ? Math.round((wipTotal / total) * 100) : 0;
  const segments: Segment[] = rows.map((r) => ({
    key: r.status,
    label: statusLabels[r.status],
    value: value(r),
    color: STATUS_COLOR[r.status],
  }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">Completion</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {completion}%
        </span>
      </div>
      <SegmentedBar segments={segments} />
      {/* In-review count is already in the funnel legend above; the
          distinct WIP ratio earns a supplementary metric line (REEF-192). */}
      <div className="text-xs text-muted-foreground">
        <MetricLine label="WIP" value={`${wip}%`} />
      </div>
    </div>
  );
}

export function DeadlineCard({ agg }: { agg: ReportAggregates }) {
  const { dueHealth } = agg;
  const withDates =
    dueHealth.overdue + dueHealth.dueThisWeek + dueHealth.upcoming;

  if (withDates === 0) {
    return (
      <Card title="Deadlines">
        <RowEmpty label="No due dates set on open work." />
      </Card>
    );
  }

  // Deadline urgency reads as a red → amber → calm ramp off the dedicated
  // deadline tokens, not the brand value color: overdue is attention
  // (`--due-overdue`), this week is soon (`--due-soon`), upcoming is the neutral
  // not-urgent tail. Keeps brand meaning "quantity", not "upcoming" (REEF-248).
  const segments: Segment[] = [
    {
      key: "overdue",
      label: "Overdue",
      value: dueHealth.overdue,
      color: "var(--due-overdue)",
    },
    {
      key: "this-week",
      label: "This week",
      value: dueHealth.dueThisWeek,
      color: "var(--due-soon)",
    },
    {
      key: "upcoming",
      label: "Upcoming",
      value: dueHealth.upcoming,
      color: "var(--status-open)",
    },
  ];

  return (
    <Card
      title="Deadlines"
      // Name the population ("Open work") like the Risk map card so the two
      // open-work cards do not read as the in-scope total, and keep the undated
      // count as the trailing detail (REEF-185).
      subtitle={
        dueHealth.noDueDate > 0
          ? `Open work · ${dueHealth.noDueDate} undated`
          : "Open work"
      }
    >
      {/* The SegmentedBar legend already labels Overdue/This week/Upcoming with
          their values, and the undated count lives in the subtitle, so the
          MetricLine grid was a verbatim repeat (REEF-192). */}
      <SegmentedBar segments={segments} />
    </Card>
  );
}

export function RowEmpty({ label }: { label?: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      {label ?? "No data in this category."}
    </p>
  );
}

function MetricLine({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <span className="flex items-center justify-between gap-2 rounded-md bg-surface-hover px-2 py-1">
      <span>{label}</span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
    </span>
  );
}

export function NamedRows({
  rows,
  measure = "count",
}: {
  rows: ReadonlyArray<NamedCount>;
  measure?: ReportMeasure;
}) {
  const value = (r: NamedCount) => (measure === "points" ? r.points : r.count);
  const max = Math.max(...rows.map(value), 1);
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li
          key={row.name}
          data-testid="named-row"
          data-name={row.name}
          data-value={value(row)}
          className="grid grid-cols-[120px_1fr_40px] items-center gap-3"
        >
          <span
            className="truncate text-xs text-foreground/90"
            title={row.name}
          >
            {row.name}
          </span>
          <Bar value={value(row)} max={max} />
          <span className="text-right text-xs font-mono tabular-nums text-muted-foreground">
            {value(row)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Bar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const scaleX = Math.max(0.02, value / max);
  return (
    <div
      aria-hidden="true"
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
    >
      {/* Composited grow-in: scaleX off a full-width track instead of animating
          width (a layout property). Gated on `motion-safe` so reduced-motion
          users get the final bar with no animation (REEF-097 AC3, REEF-248). */}
      <div
        className="h-full w-full origin-left rounded-full ease-out motion-safe:transition-transform motion-safe:duration-500"
        style={{
          transform: `scaleX(${scaleX})`,
          backgroundColor: color ?? "var(--brand)",
          opacity: color ? 0.85 : 0.7,
        }}
      />
    </div>
  );
}

export function formatSigned(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}
