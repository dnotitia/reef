"use client";

import { Button } from "@/components/ui/button";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useMemo, useState } from "react";
import {
  DEFAULT_REPORT_FILTERS,
  type ReportFilters,
  computeAggregates,
} from "../lib/aggregate";
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
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);

  // Aggregation is a single pass over every issue; memoize so unrelated
  // re-renders (e.g. a sibling popover opening) don't recompute it.
  const issues = useMemo(() => issuesQuery.data ?? [], [issuesQuery.data]);
  const agg = useMemo(
    () => computeAggregates(issues, { filters }),
    [issues, filters],
  );

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
          </EmptyState>
        ) : (
          <>
            <HealthSummary agg={agg} />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card
                title="Risk map"
                subtitle="Open work · priority x last update"
              >
                <RiskMatrix buckets={agg.riskMatrix} />
              </Card>

              <Card
                title="Throughput"
                subtitle={`${formatSigned(agg.riskSummary.netThroughput)} net`}
              >
                <NetThroughputChart points={agg.netThroughput} />
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card title="Workflow" subtitle={`${agg.total} in scope`}>
                <StatusFunnel rows={agg.byStatus} agg={agg} />
              </Card>

              <DeadlineCard agg={agg} />

              <Card title="By type">
                <RankedBarList
                  rows={agg.byType.map((b) => ({
                    key: b.type,
                    label: TYPE_META[b.type].label,
                    value: b.count,
                    color: TYPE_META[b.type].color,
                  }))}
                />
              </Card>

              <Card title="Top assignees" subtitle="In scope, top 5">
                {agg.topAssignees.length === 0 ? (
                  <RowEmpty />
                ) : (
                  <NamedRows rows={agg.topAssignees} />
                )}
              </Card>

              <Card title="Top labels" subtitle="In scope, top 8">
                {agg.topLabels.length === 0 ? (
                  <RowEmpty />
                ) : (
                  <NamedRows rows={agg.topLabels} />
                )}
              </Card>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
