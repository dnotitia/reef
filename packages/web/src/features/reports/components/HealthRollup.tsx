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
  distinctParentIds,
} from "../lib/healthRollup";

/**
 * Portfolio health rollup (REEF-191, parent axis REEF-187). A worst-first
 * ranked list of milestones / sprints / releases / parent initiatives, each
 * with a computed RAG verdict (On track / At risk / Off track) derived from the
 * same signals as the rest of the reports surface. Clicking a row scopes the
 * detail charts below to that item via the shared report filters.
 *
 * The parent axis is the same drill-down `IssueChildren` shows for one epic,
 * lifted to a portfolio comparison the issue detail sheet doesn't give: every
 * parent ranked side by side, worst-first (REEF-187).
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
    parent: { one: "Parent", many: "Parents" },
  };

const AXIS_KEY: Record<RollupDimension, keyof ReportFilters> = {
  milestone: "milestone_id",
  sprint: "sprint_id",
  release: "release_id",
  parent: "parent_id",
};

function dimensionItemCount(
  dimension: RollupDimension,
  catalog: PlanningCatalog,
  issues: ReadonlyArray<IssueListItem>,
): number {
  if (dimension === "milestone") return catalog.milestones.length;
  if (dimension === "sprint") return catalog.sprints.length;
  if (dimension === "release") return catalog.releases.length;
  // Parent isn't a catalog entity — count the distinct parents issues point at.
  return distinctParentIds(issues).length;
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
  // Offer dimensions that have items; derive during render so a vault switch
  // does not strand the toggle on an empty dimension (no effect). The parent
  // axis depends on issues (referenced parents), the planning axes on catalog.
  const availableDims = useMemo(
    () =>
      ROLLUP_DIMENSIONS.filter(
        (d) => dimensionItemCount(d, catalog, issues) > 0,
      ),
    [catalog, issues],
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
  // Summarize the two unhealthy levels separately, worst first — folding them
  // into one "at risk" count would mislabel off-track items (REEF-191).
  const offTrack = visibleRows.filter(
    (r) => r.verdict?.level === "off_track",
  ).length;
  const atRisk = visibleRows.filter(
    (r) => r.verdict?.level === "at_risk",
  ).length;
  const flags = [
    offTrack > 0 ? `${offTrack} off track` : null,
    atRisk > 0 ? `${atRisk} at risk` : null,
  ].filter(Boolean);
  const label = DIMENSION_LABEL[activeDim];
  const activeId = filters[AXIS_KEY[activeDim]];

  return (
    <section
      data-testid="health-rollup"
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Portfolio health
          </h3>
          <span className="text-[11px] text-muted-foreground">
            {visibleRows.length}{" "}
            {(visibleRows.length === 1 ? label.one : label.many).toLowerCase()}
            {flags.length > 0 ? ` · ${flags.join(" · ")}` : ""}
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
                "rounded-md border border-border-subtle px-2 py-1 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
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
              "rounded-[5px] px-2 py-1 text-[12px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
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
          "relative grid w-full grid-cols-1 items-center gap-2 rounded-md border border-border-subtle bg-background py-2.5 pr-3 pl-4 text-left transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4",
          active && "ring-1 ring-brand/40",
        )}
      >
        {/* Verdict rail — the at-a-glance scan signal, paired with
            the colored verdict label (the HealthSummary danger-tile idiom: rail +
            colored text, no badge). On track stays thin so red/amber lead. */}
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
              <span
                className="shrink-0 text-[11px] font-medium"
                style={{ color: meta.color }}
              >
                {meta.label}
              </span>
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
          <div className="justify-self-end">
            <CompletionBar value={row.completion} />
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

function CompletionBar({ value }: { value: number }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div
        aria-hidden="true"
        className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-hover"
      >
        {/* Composited grow-in: scaleX off a full-width track, not width. Gated on
            `motion-safe` so reduced-motion gets the final bar (REEF-097, REEF-248). */}
        <div
          className="h-full w-full origin-left rounded-full ease-out motion-safe:transition-transform motion-safe:duration-500"
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
