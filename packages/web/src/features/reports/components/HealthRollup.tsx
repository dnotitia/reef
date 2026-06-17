"use client";

import { formatDisplayDate } from "@/features/issues/lib/dateHelpers";
import { cn } from "@/lib/utils";
import type { IssueListItem, PlanningCatalog } from "@reef/core";
import { memo, useMemo, useState } from "react";
import type { ReportFilters } from "../lib/aggregate";
import { DAY_MS } from "../lib/aggregateModel";
import {
  type HealthRollupRow,
  ROLLUP_DIMENSIONS,
  type RagLevel,
  type RollupDimension,
  computeHealthRollup,
} from "../lib/healthRollup";
import { formatSigned } from "./ReportSummarySections";

/**
 * Portfolio health rollup (REEF-191). A worst-first ranked list of milestones /
 * sprints / releases, each with a computed RAG verdict (On track / At risk /
 * Off track) derived from the same signals as the rest of the reports surface.
 * Clicking a row scopes the detail charts below to that planning item via the
 * shared report filters.
 */

/** RAG → token + label. Mirrors the `STATUS_COLOR` / `TYPE_META` convention
 *  (a TS record pointing at existing CSS tokens) rather than minting new
 *  globals — On track reuses the done green, At risk the medium-priority amber,
 *  Off track the destructive red. */
const RAG_META: Record<RagLevel, { label: string; color: string }> = {
  on_track: { label: "On track", color: "var(--status-done)" },
  at_risk: { label: "At risk", color: "var(--priority-medium)" },
  off_track: { label: "Off track", color: "var(--destructive)" },
};

const DIMENSION_LABEL: Record<RollupDimension, { one: string; many: string }> =
  {
    milestone: { one: "Milestone", many: "Milestones" },
    sprint: { one: "Sprint", many: "Sprints" },
    release: { one: "Release", many: "Releases" },
  };

const AXIS_KEY: Record<RollupDimension, keyof ReportFilters> = {
  milestone: "milestone_id",
  sprint: "sprint_id",
  release: "release_id",
};

function dimensionItemCount(
  catalog: PlanningCatalog,
  dimension: RollupDimension,
): number {
  if (dimension === "milestone") return catalog.milestones.length;
  if (dimension === "sprint") return catalog.sprints.length;
  return catalog.releases.length;
}

export function HealthRollup({
  issues,
  catalog,
  filters,
  onDrill,
}: {
  issues: ReadonlyArray<IssueListItem>;
  catalog: PlanningCatalog;
  filters: ReportFilters;
  /** Toggle the page scope to one planning item (drill in / out). */
  onDrill: (dimension: RollupDimension, id: string) => void;
}) {
  // Only offer dimensions that actually have items; derive during render so a
  // vault switch can't strand the toggle on an empty dimension (no effect).
  const availableDims = useMemo(
    () => ROLLUP_DIMENSIONS.filter((d) => dimensionItemCount(catalog, d) > 0),
    [catalog],
  );
  const [dimension, setDimension] = useState<RollupDimension>("milestone");
  const [showShipped, setShowShipped] = useState(false);

  const activeDim = availableDims.includes(dimension)
    ? dimension
    : (availableDims[0] ?? "milestone");

  const rows = useMemo(
    () =>
      computeHealthRollup(issues, { dimension: activeDim, catalog, filters }),
    [issues, activeDim, catalog, filters],
  );

  if (availableDims.length === 0) return null;

  const hasShipped = rows.some((r) => r.shipped);
  const visibleRows = showShipped ? rows : rows.filter((r) => !r.shipped);
  const atRisk = visibleRows.filter(
    (r) => r.verdict && r.verdict.level !== "on_track",
  ).length;
  const label = DIMENSION_LABEL[activeDim];
  const activeId = filters[AXIS_KEY[activeDim]];

  return (
    <section
      data-testid="health-rollup"
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            Portfolio health
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {visibleRows.length} {label.many.toLowerCase()}
            {atRisk > 0 ? ` · ${atRisk} need attention` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hasShipped && (
            <button
              type="button"
              aria-pressed={showShipped}
              onClick={() => setShowShipped((s) => !s)}
              data-testid="health-rollup-show-shipped"
              className={cn(
                "rounded-md border border-border-subtle px-2 py-1 text-[11px] font-medium transition-colors duration-150",
                showShipped
                  ? "bg-surface-hover text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Show shipped
            </button>
          )}
          {availableDims.length > 1 && (
            <DimensionToggle
              dims={availableDims}
              active={activeDim}
              onSelect={setDimension}
            />
          )}
        </div>
      </header>

      {visibleRows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No {label.many.toLowerCase()} to show.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {visibleRows.map((row) => (
            <HealthRow
              key={row.id}
              row={row}
              active={activeId === row.id}
              onDrill={onDrill}
            />
          ))}
        </ul>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Off track: a missed target or far behind pace. At risk: overdue,
        blocked, behind pace, or a growing backlog. Otherwise on track.
      </p>
    </section>
  );
}

function DimensionToggle({
  dims,
  active,
  onSelect,
}: {
  dims: ReadonlyArray<RollupDimension>;
  active: RollupDimension;
  onSelect: (dim: RollupDimension) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a header toggle group is not a form <fieldset>; role="group" + aria-label is the right semantics here (matches ViewSwitcher).
    <div
      role="group"
      aria-label="Rollup dimension"
      data-testid="health-rollup-dimension"
      className="inline-flex items-center gap-0.5 rounded-md border border-border-subtle bg-elevated p-0.5"
    >
      {dims.map((dim) => {
        const isActive = dim === active;
        return (
          <button
            key={dim}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(dim)}
            data-testid={`health-rollup-dimension-${dim}`}
            className={cn(
              "rounded-[5px] px-2 py-1 text-[12px] font-medium transition-colors duration-150",
              isActive
                ? "bg-surface-hover text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {DIMENSION_LABEL[dim].many}
          </button>
        );
      })}
    </div>
  );
}

const HealthRow = memo(function HealthRow({
  row,
  active,
  onDrill,
}: {
  row: HealthRollupRow;
  active: boolean;
  onDrill: (dimension: RollupDimension, id: string) => void;
}) {
  const meta = row.verdict ? RAG_META[row.verdict.level] : null;
  const rail = meta?.color ?? "var(--border-subtle)";

  return (
    <li>
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onDrill(row.kind, row.id)}
        data-testid={`health-rollup-row-${row.id}`}
        className={cn(
          "relative grid w-full grid-cols-1 items-center gap-2 rounded-md border border-border-subtle bg-background py-2.5 pr-3 pl-4 text-left transition-colors duration-150 hover:bg-surface-hover sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4",
          active && "ring-1 ring-brand/40",
        )}
      >
        {/* Verdict rail — the at-a-glance vertical scan signal. On track stays
            thin/neutral so red and amber carry the visual weight. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1 rounded-l-md"
          style={{
            backgroundColor: rail,
            opacity: row.verdict?.level === "on_track" ? 0.4 : 1,
          }}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {row.name}
            </span>
            {meta ? (
              <RagPill color={meta.color} label={meta.label} />
            ) : (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                Empty
              </span>
            )}
          </div>
          <span className="truncate text-[11px] text-muted-foreground">
            <Subline row={row} />
          </span>
        </div>

        {row.verdict && (
          <div className="flex items-center justify-end gap-3 sm:gap-4">
            <CompletionBar value={row.completion} />
            <div className="flex items-center gap-3">
              {row.overdue > 0 && (
                <Signal label="overdue" value={row.overdue} tone="danger" />
              )}
              {row.blocked > 0 && (
                <Signal label="blocked" value={row.blocked} tone="warn" />
              )}
              <Signal
                label="net"
                value={formatSigned(row.net)}
                tone={row.net > 0 ? "warn" : "quiet"}
              />
            </div>
          </div>
        )}
      </button>
    </li>
  );
});

function Subline({ row }: { row: HealthRollupRow }) {
  const parts: string[] = [];
  if (row.shipped) {
    parts.push("Shipped");
  } else if (row.targetDate) {
    parts.push(
      `${formatDisplayDate(row.targetDate.slice(0, 10))} · ${deadlineNote(row.targetDate)}`,
    );
  } else if (row.verdict) {
    parts.push("No target date");
  }
  if (row.verdict && row.verdict.level !== "on_track") {
    parts.push(row.verdict.reason);
  }
  if (!row.verdict) parts.push("No issues yet");
  return <>{parts.join(" · ")}</>;
}

function deadlineNote(targetDate: string): string {
  const days = Math.round((Date.parse(targetDate) - Date.now()) / DAY_MS);
  if (Number.isNaN(days)) return "";
  if (days === 0) return "due today";
  if (days > 0) return `${days}d left`;
  return `${-days}d overdue`;
}

function RagPill({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{
        color,
        borderColor: `color-mix(in oklab, ${color} 30%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
      }}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function CompletionBar({ value }: { value: number }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div
        aria-hidden="true"
        className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-hover"
      >
        {/* Composited grow-in: scaleX off a full-width track, not width (REEF-097). */}
        <div
          className="h-full w-full origin-left rounded-full transition-transform duration-500 ease-out"
          style={{
            transform: `scaleX(${Math.max(0.02, value)})`,
            backgroundColor: "var(--brand)",
            opacity: 0.7,
          }}
        />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

function Signal({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "danger" | "warn" | "quiet";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 text-[11px]",
        tone === "danger" && "text-destructive",
        tone === "warn" && "text-priority-high",
        tone === "quiet" && "text-muted-foreground",
      )}
    >
      <span className="uppercase tracking-wide">{label}</span>
      <span className="font-mono font-medium tabular-nums">{value}</span>
    </span>
  );
}
