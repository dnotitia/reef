"use client";

import { Button } from "@/components/ui/button";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { usePlanningCatalog } from "@/features/planning/hooks/usePlanningCatalog";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { SEVERITY_LABELS } from "@reef/core/fields";
import { useCallback, useMemo, useState } from "react";
import {
  DEFAULT_REPORT_FILTERS,
  PERIOD_LABELS,
  type ReportFilters,
  computeAggregates,
} from "../lib/aggregate";
import type { RollupDimension } from "../lib/healthRollup";
import { HealthRollup } from "./HealthRollup";
import { NetThroughputChart, RankedBarList, RiskMatrix } from "./ReportCharts";
import { Card, EmptyState, PageShell, ReportsSkeleton } from "./ReportLayout";
import { ReportScopeBar } from "./ReportScopeBar";
import {
  DeadlineCard,
  HealthSummary,
  NamedRows,
  RowEmpty,
  StatusFunnel,
  TYPE_META,
  formatSigned,
} from "./ReportSummarySections";

export function ReportsPage() {
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const issuesQuery = useIssueList(vault);
  const planningQuery = usePlanningCatalog(vault);
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);

  // Aggregation is a single pass over every issue; memoize so unrelated
  // re-renders (e.g. a sibling popover opening) don't recompute it.
  const issues = useMemo(() => issuesQuery.data ?? [], [issuesQuery.data]);
  const agg = useMemo(
    () => computeAggregates(issues, { filters }),
    [issues, filters],
  );

  // Drilling a rollup row scopes the whole page to that planning item by
  // setting its shared report filter; clicking the active row clears it. The
  // functional update keeps the callback identity stable across renders.
  const handleDrill = useCallback((dimension: RollupDimension, id: string) => {
    const key =
      dimension === "milestone"
        ? "milestone_id"
        : dimension === "sprint"
          ? "sprint_id"
          : dimension === "release"
            ? "release_id"
            : "parent_id";
    setFilters((current) => ({
      ...current,
      [key]: current[key] === id ? undefined : id,
    }));
  }, []);

  const catalog = planningQuery.data;

  // The parent rollup drill is the one report facet with no scope-bar control
  // (the planning axes each have a combobox there). Resolve its label so the
  // empty-state clear affordance below can name the parent it scopes to.
  const parentScopeName = filters.parent_id
    ? (issues.find((issue) => issue.id === filters.parent_id)?.title ??
      filters.parent_id)
    : null;

  // The measure toggle only re-weights the load/throughput cards (Risk map,
  // Deadlines, and the KPI tiles stay count-based posture). Naming the measure
  // on each switched card keeps the partial scoping from reading as broken —
  // the same affordance the Period control uses on the Throughput card
  // (REEF-185, REEF-188).
  const pointsMode = filters.measure === "points";
  const netValue = pointsMode
    ? agg.netThroughput.reduce((sum, week) => sum + week.netPoints, 0)
    : agg.riskSummary.netThroughput;

  if (!vaultLoading && !vault) {
    return (
      <PageShell>
        <EmptyState>
          <p className="text-sm text-muted-foreground">
            Pick a workspace in{" "}
            <a
              href="/settings"
              className="text-foreground underline-offset-4 hover:underline"
            >
              Settings
            </a>{" "}
            to see reports.
          </p>
        </EmptyState>
      </PageShell>
    );
  }

  if (vaultLoading || issuesQuery.isPending) {
    return (
      <PageShell>
        <ReportsSkeleton />
      </PageShell>
    );
  }

  if (issuesQuery.isError) {
    return (
      <PageShell>
        <div
          data-testid="reports-error"
          className="flex flex-col items-start gap-2"
        >
          <p className="text-sm text-destructive">
            {issuesQuery.error instanceof Error
              ? issuesQuery.error.message
              : "Failed to load issues."}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void issuesQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      </PageShell>
    );
  }

  if (issues.length === 0) {
    return (
      <PageShell>
        <EmptyState>
          <p className="text-sm text-muted-foreground">
            No active issues yet. Create one to start building reports.
          </p>
        </EmptyState>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div data-testid="reports-page" className="flex flex-col gap-6">
        <ReportScopeBar filters={filters} onChange={setFilters} />

        {agg.filteredTotal === 0 ? (
          <EmptyState>
            <p className="text-sm text-muted-foreground">
              No matching report data. Adjust the report scope to widen the
              view.
            </p>
            {/* A parent drill empties the page without leaving a scope-bar
                control to undo it (unlike the planning axes), and the rollup row
                — the normal clear path — is gone in this empty branch. Offer the
                clear here so the parent scope can't trap the page (REEF-187). */}
            {filters.parent_id && (
              <Button
                variant="outline"
                size="sm"
                data-testid="reports-clear-parent-scope"
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    parent_id: undefined,
                  }))
                }
              >
                Clear parent filter
                {parentScopeName ? `: ${parentScopeName}` : ""}
              </Button>
            )}
          </EmptyState>
        ) : (
          <>
            <HealthSummary agg={agg} />

            {/* Per-item RAG rollup sits between the global pulse and the detail
                charts — a scannable portfolio index that drills into them. The
                component self-hides when no dimension has items (planning axes
                from the catalog, parent axis from issue links), so the guard is
                just catalog presence. */}
            {catalog && (
              <HealthRollup
                issues={issues}
                catalog={catalog}
                filters={filters}
                onDrill={handleDrill}
              />
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card
                title="Risk map"
                subtitle="Open work · priority x last update"
              >
                <RiskMatrix buckets={agg.riskMatrix} />
              </Card>

              <Card
                title="Throughput"
                subtitle={`${PERIOD_LABELS[filters.period]} · ${formatSigned(
                  netValue,
                )} ${pointsMode ? "pts net" : "net"}`}
              >
                <NetThroughputChart
                  points={agg.netThroughput}
                  measure={filters.measure}
                />
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card
                title="Workflow"
                subtitle={
                  pointsMode
                    ? `Story points · ${agg.total} in scope`
                    : `${agg.total} in scope`
                }
              >
                <StatusFunnel rows={agg.byStatus} measure={filters.measure} />
              </Card>

              <DeadlineCard agg={agg} />

              <Card
                title="By type"
                subtitle={pointsMode ? "Story points · in scope" : "In scope"}
              >
                <RankedBarList
                  rows={agg.byType.map((b) => ({
                    key: b.type,
                    label: TYPE_META[b.type].label,
                    value: pointsMode ? b.points : b.count,
                    color: TYPE_META[b.type].color,
                  }))}
                />
              </Card>

              {/* Severity is sparsely populated (only bugs carry it), so the
                  card is omitted entirely when nothing has a severity rather
                  than showing a perpetually-empty panel (REEF-186). bySeverity
                  is pre-filtered to count > 0 by the aggregator. Bars stay
                  neutral: the severity tokens are glyph colors, not fills
                  (globals.css), and the row label already names the severity —
                  a colored bar would just re-encode that identity. */}
              {agg.bySeverity.length > 0 && (
                <Card
                  title="By severity"
                  subtitle={pointsMode ? "Story points · in scope" : "In scope"}
                >
                  <RankedBarList
                    rows={agg.bySeverity.map((b) => ({
                      key: b.severity,
                      label: SEVERITY_LABELS[b.severity],
                      value: pointsMode ? b.points : b.count,
                    }))}
                  />
                </Card>
              )}

              <Card
                title="Top assignees"
                subtitle={
                  pointsMode ? "Story points · top 5" : "In scope, top 5"
                }
              >
                {agg.topAssignees.length === 0 ? (
                  <RowEmpty />
                ) : (
                  <NamedRows
                    rows={agg.topAssignees}
                    measure={filters.measure}
                  />
                )}
              </Card>

              <Card
                title="Top labels"
                subtitle={
                  pointsMode ? "Story points · top 8" : "In scope, top 8"
                }
              >
                {agg.topLabels.length === 0 ? (
                  <RowEmpty />
                ) : (
                  <NamedRows rows={agg.topLabels} measure={filters.measure} />
                )}
              </Card>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
