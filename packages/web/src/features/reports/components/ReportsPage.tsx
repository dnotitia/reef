"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { EmptyWorkspaceNotice } from "@/features/ui/components/EmptyWorkspaceNotice";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { preloadNewIssueDialog } from "@/features/ui/lib/lazyDialogPreload";
import { useViewStore } from "@/features/ui/stores/useViewStore";
import { useIssueTypeLabels, useSeverityLabels } from "@/i18n/fieldLabels";
import {
  DEFAULT_REPORT_FILTERS,
  type PivotFieldKey,
  type ReportFilters,
  type ReportRequest,
  type RollupDimension,
} from "@reef/core";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { useReportPeriodLabels } from "../lib/useReportPeriodLabels";
import { useReports } from "../hooks/queries/useReports";
import { ForecastCard } from "./ForecastCard";
import { FlowMetricsCard } from "./FlowMetricsCard";
import { HealthRollup } from "./HealthRollup";
import { PivotCard } from "./PivotCard";
import { NetThroughputChart, RankedBarList, RiskMatrix } from "./ReportCharts";
import {
  Card,
  PageShell,
  ReportSection,
  ReportsSkeleton,
} from "./ReportLayout";
import { ReportScopeBar } from "./ReportScopeBar";
import {
  DeadlineCard,
  HealthSummary,
  NamedRows,
  RowEmpty,
  StatusFunnel,
  formatSigned,
} from "./ReportSummarySections";

export function ReportsPage() {
  const t = useTranslations("reports.page");
  const nav = useTranslations("nav");
  const c = useTranslations("common");
  const periodLabels = useReportPeriodLabels();
  const severityLabels = useSeverityLabels();
  const issueTypeLabels = useIssueTypeLabels();
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const openNewIssueDialog = useViewStore((state) => state.openNewIssueDialog);
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const [rollupDimension, setRollupDimension] =
    useState<RollupDimension>("milestone");
  const [pivotRow, setPivotRow] = useState<PivotFieldKey>("assignee");
  const [pivotCol, setPivotCol] = useState<PivotFieldKey>("status");
  const [nowMs] = useState(() => Date.now());
  const request = useMemo<ReportRequest>(
    () => ({ filters, asOf: nowMs, rollupDimension, pivotRow, pivotCol }),
    [filters, nowMs, rollupDimension, pivotRow, pivotCol],
  );
  const reportsQuery = useReports(vault, request);

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

  const clearParentScope = useCallback(() => {
    setFilters((current) => {
      const next = { ...current };
      next.parent_id = undefined;
      return next;
    });
  }, []);

  if (!vaultLoading && !vault) {
    // App-level "no workspace" gate, shared across all five surfaces (REEF-259).
    // It renders beneath the header without PageShell's PageBody so the shared
    // notice can self-center; PageShell + EmptyState below stay for the
    // section-level empty/error states that do carry a vault.
    return (
      <div className="flex h-full flex-col">
        <PageHeader title={nav("reports")} />
        <EmptyWorkspaceNotice />
      </div>
    );
  }

  if (vaultLoading || reportsQuery.isPending) {
    return (
      <PageShell description={vault || undefined}>
        <ReportsSkeleton />
      </PageShell>
    );
  }

  if (reportsQuery.isError) {
    return (
      <PageShell description={vault || undefined}>
        <div
          data-testid="reports-error"
          className="flex flex-col items-start gap-2"
        >
          <p className="text-sm text-destructive-text">{t("failedToLoad")}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void reportsQuery.refetch()}
            busy={reportsQuery.isFetching}
            aria-label={c("retry")}
          >
            {c("retry")}
          </Button>
        </div>
      </PageShell>
    );
  }

  const report = reportsQuery.data;
  if (!report) {
    return (
      <PageShell description={vault || undefined}>
        <ReportsSkeleton />
      </PageShell>
    );
  }

  if (report.issueCount === 0) {
    return (
      <PageShell
        description={vault || undefined}
        actions={
          <Button
            type="button"
            size="sm"
            onClick={() => {
              preloadNewIssueDialog();
              openNewIssueDialog();
            }}
            onMouseEnter={preloadNewIssueDialog}
            onFocus={preloadNewIssueDialog}
            className="gap-1.5"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            {nav("newIssue")}
          </Button>
        }
      >
        <EmptyState
          data-testid="reports-empty"
          title={t("noActiveIssuesTitle")}
          description={t("noActiveIssuesDescription")}
        />
      </PageShell>
    );
  }

  const agg = report.aggregates;
  const flowMetrics = report.flowMetrics;
  const forecast = report.forecast;
  const parentScopeName = report.parentName;
  const pointsMode = filters.measure === "points";
  const netValue = pointsMode
    ? agg.netThroughput.reduce((sum, week) => sum + week.netPoints, 0)
    : agg.riskSummary.netThroughput;

  return (
    <PageShell description={vault || undefined}>
      <div data-testid="reports-page" className="flex flex-col gap-6">
        <ReportScopeBar filters={filters} onChange={setFilters} />

        {agg.filteredTotal === 0 ? (
          <div className="flex flex-col gap-3">
            <EmptyState
              data-testid="reports-empty"
              title={t("noMatchingDataTitle")}
              description={t("noMatchingDataDescription")}
            />
            {filters.parent_id ? (
              <div className="flex justify-center">
                {/* A parent drill empties the page without leaving a scope-bar
                   control to undo it (unlike the planning axes), and the rollup row
                   — the normal clear path — is gone in this empty branch. Keep the
                   existing clear control outside the empty frame so it does not
                   change the section's content hierarchy (REEF-187). */}
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="reports-clear-parent-scope"
                  onClick={clearParentScope}
                >
                  {parentScopeName
                    ? t("clearParentFilterFor", { name: parentScopeName })
                    : t("clearParentFilter")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          // Three scan bands — present state, flow over time, and the static
          // breakdowns — so the long card stack reads as a few named groups with
          // an entry point, not one flat wall (REEF-248). Sections sit further
          // apart (gap-10) than the cards within a section (gap-6) so the
          // grouping reads from rhythm as well as from the labels.
          <div className="flex flex-col gap-10">
            <ReportSection label={t("snapshot")}>
              <div className="flex flex-col gap-4">
                <HealthSummary agg={agg} />

                {/* Per-item RAG rollup is precomputed with the report payload. */}
                {report.availableDimensions.length > 0 && (
                  <HealthRollup
                    rows={report.healthRollup}
                    availableDimensions={report.availableDimensions}
                    filters={filters}
                    dimension={report.rollupDimension}
                    onDimensionChange={setRollupDimension}
                    onDrill={handleDrill}
                  />
                )}
              </div>
            </ReportSection>

            <ReportSection label={t("flowForecast")}>
              <div className="flex flex-col gap-6">
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <Card title={t("riskMap")} subtitle={t("riskMapSubtitle")}>
                    <RiskMatrix buckets={agg.riskMatrix} />
                  </Card>

                  <Card
                    title={t("throughput")}
                    subtitle={
                      pointsMode
                        ? t("throughputSubtitlePoints", {
                            period: periodLabels[filters.period],
                            net: formatSigned(netValue),
                          })
                        : t("throughputSubtitleCount", {
                            period: periodLabels[filters.period],
                            net: formatSigned(netValue),
                          })
                    }
                  >
                    <NetThroughputChart
                      points={agg.netThroughput}
                      measure={filters.measure}
                    />
                  </Card>
                </div>

                <FlowMetricsCard
                  metrics={flowMetrics}
                  periodLabel={periodLabels[filters.period]}
                  vault={vault}
                />

                {/* Forward-looking forecast sits right after the present-state
                    Risk map / Throughput row: same throughput it samples, now
                    projected (REEF-190). */}
                <ForecastCard
                  forecast={forecast}
                  now={report.asOf}
                  periodLabel={periodLabels[filters.period]}
                />

                {/* Custom crosstab — the one card that answers an ad-hoc cross
                    (assignee × status, type × priority, ...) without shipping a
                    new fixed card. Full width: it can grow to many columns
                    (REEF-189). */}
                <PivotCard
                  result={report.pivot}
                  rowField={pivotRow}
                  colField={pivotCol}
                  onRowFieldChange={setPivotRow}
                  onColFieldChange={setPivotCol}
                />
              </div>
            </ReportSection>

            <ReportSection label={t("breakdown")}>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card
                  title={t("workflow")}
                  subtitle={
                    pointsMode
                      ? t("workflowSubtitlePoints", { total: agg.total })
                      : t("workflowSubtitleCount", { total: agg.total })
                  }
                >
                  <StatusFunnel rows={agg.byStatus} measure={filters.measure} />
                </Card>

                <DeadlineCard agg={agg} />

                <Card
                  title={t("byType")}
                  subtitle={pointsMode ? t("storyPointsInScope") : t("inScope")}
                >
                  <RankedBarList
                    rows={agg.byType.map((b) => ({
                      key: b.type,
                      label: issueTypeLabels[b.type],
                      value: pointsMode ? b.points : b.count,
                    }))}
                  />
                </Card>

                {/* Severity is sparsely populated (bugs carry it), so the
                    card is omitted entirely when nothing has a severity rather
                    than showing a perpetually-empty panel (REEF-186). bySeverity
                    is pre-filtered to count > 0 by the aggregator. Bars stay
                    neutral — the same value-bar idiom as every other breakdown
                    card (REEF-248): the row label already names the severity, so
                    a colored bar would re-encode that identity. */}
                {agg.bySeverity.length > 0 && (
                  <Card
                    title={t("bySeverity")}
                    subtitle={
                      pointsMode ? t("storyPointsInScope") : t("inScope")
                    }
                  >
                    <RankedBarList
                      rows={agg.bySeverity.map((b) => ({
                        key: b.severity,
                        label: severityLabels[b.severity],
                        value: pointsMode ? b.points : b.count,
                      }))}
                    />
                  </Card>
                )}

                <Card
                  title={t("topAssignees")}
                  subtitle={
                    pointsMode
                      ? t("topAssigneesSubtitlePoints")
                      : t("topAssigneesSubtitleCount")
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
                  title={t("topLabels")}
                  subtitle={
                    pointsMode
                      ? t("topLabelsSubtitlePoints")
                      : t("topLabelsSubtitleCount")
                  }
                >
                  {agg.topLabels.length === 0 ? (
                    <RowEmpty />
                  ) : (
                    <NamedRows rows={agg.topLabels} measure={filters.measure} />
                  )}
                </Card>
              </div>
            </ReportSection>
          </div>
        )}
      </div>
    </PageShell>
  );
}
