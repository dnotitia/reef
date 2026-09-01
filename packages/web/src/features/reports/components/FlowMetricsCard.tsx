"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { withVault } from "@/lib/workspaceHref";
import type {
  FlowMetricKind,
  FlowMetricResult,
  FlowMetrics,
} from "../lib/aggregateModel";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { Card } from "./ReportLayout";
import { FlowMetricsChart } from "./ReportCharts";

export interface FlowMetricsCardProps {
  metrics: FlowMetrics;
  periodLabel: string;
  vault: string;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  onRetry: () => void;
}

export function FlowMetricsCard({
  metrics,
  periodLabel,
  vault,
  isPending,
  isError,
  isFetching,
  onRetry,
}: FlowMetricsCardProps) {
  const t = useTranslations("reports.cards");
  const common = useTranslations("common");
  const [metric, setMetric] = useState<FlowMetricKind>("cycle");
  const metricResult = metrics[metric];
  const metricLabel = t(metric === "cycle" ? "cycleTime" : "leadTime");

  return (
    <Card
      title={t("flowMetrics")}
      subtitle={t("flowMetricsSubtitle", { period: periodLabel })}
      testId="report-card-flow-metrics"
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3"
        role="group"
        aria-label={t("flowMetricSelector")}
      >
        <div className="flex items-center gap-1 rounded-md bg-surface-hover p-1">
          {(["cycle", "lead"] as const).map((value) => {
            const selected = metric === value;
            return (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={selected ? "default" : "ghost"}
                aria-pressed={selected}
                data-testid={`flow-metric-${value}`}
                onClick={() => setMetric(value)}
              >
                {t(value === "cycle" ? "cycleTime" : "leadTime")}
              </Button>
            );
          })}
        </div>
        <span className="type-caption text-muted-foreground">
          {t("completionWindowLabel", { period: periodLabel })}
        </span>
      </div>

      {isPending ? (
        <FlowMetricsLoading />
      ) : isError ? (
        <div
          data-testid="flow-metrics-error"
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive-focus/30 bg-destructive-fill/[0.04] px-3 py-3"
        >
          <p className="text-sm text-destructive-text">
            {t("flowMetricsError")}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            busy={isFetching}
            onClick={onRetry}
            aria-label={common("retry")}
          >
            {common("retry")}
          </Button>
        </div>
      ) : (
        <FlowMetricResultView
          metric={metric}
          result={metricResult}
          metricLabel={metricLabel}
          vault={vault}
        />
      )}
    </Card>
  );
}

function FlowMetricsLoading() {
  const common = useTranslations("common");
  return (
    <div data-testid="flow-metrics-loading" className="flex flex-col gap-4">
      <output className="sr-only">{common("loading")}</output>
      <div className="h-40 w-full animate-pulse rounded-md bg-surface-hover" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-hidden="true">
        {["one", "two", "three", "four"].map((key) => (
          <div
            key={key}
            className="h-12 animate-pulse rounded-md bg-surface-hover"
          />
        ))}
      </div>
    </div>
  );
}

function FlowMetricResultView({
  metric,
  result,
  metricLabel,
  vault,
}: {
  metric: FlowMetricKind;
  result: FlowMetricResult;
  metricLabel: string;
  vault: string;
}) {
  const t = useTranslations("reports.cards");
  const locale = useLocale();
  if (result.measuredCount === 0) {
    return (
      <div className="flex flex-col gap-3">
        <EmptyState
          data-testid={`flow-metrics-empty-${metric}`}
          title={t("flowMetricsEmptyTitle", { metric: metricLabel })}
          description={t("flowMetricsEmptyDescription")}
          className="max-w-none"
        />
        <FlowStat
          label={t("measurementCoverage")}
          value={t("coverageValue", {
            measured: result.measuredCount,
            total: result.completionWindowCount,
            percent: formatPercent(result.coveragePercent, locale),
          })}
        />
      </div>
    );
  }

  const percentiles = result.percentiles;
  if (!percentiles) return null;

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <FlowStat
          label={t("measurementCoverage")}
          value={t("coverageValue", {
            measured: result.measuredCount,
            total: result.completionWindowCount,
            percent: formatPercent(result.coveragePercent, locale),
          })}
        />
        <FlowStat
          label={t("p50")}
          value={formatDays(percentiles.p50, locale)}
        />
        <FlowStat
          label={t("p85")}
          value={formatDays(percentiles.p85, locale)}
        />
        <FlowStat
          label={t("p95")}
          value={formatDays(percentiles.p95, locale)}
        />
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-2 type-caption text-muted-foreground">
        <span>{t("sleValue", { days: result.sleDays ?? 0 })}</span>
        {result.lowSample ? (
          <span data-testid={`flow-metrics-low-sample-${metric}`}>
            {t("lowSample", { count: result.measuredCount })}
          </span>
        ) : null}
      </div>

      <FlowMetricsChart result={result} metricLabel={metricLabel} />

      {result.outliers.length > 0 ? (
        <section
          aria-labelledby={`flow-outliers-${metric}`}
          data-testid={`flow-metrics-outliers-${metric}`}
          className="flex flex-col gap-2"
        >
          <h4
            id={`flow-outliers-${metric}`}
            className="type-section-label text-foreground"
          >
            {t("outliers")}
          </h4>
          <ul className="flex flex-col divide-y divide-border-subtle rounded-md border border-border-subtle">
            {result.outliers.map((point) => (
              <li
                key={point.issueId}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2"
              >
                <Link
                  href={withVault(
                    vault,
                    `/issues/${encodeURIComponent(point.issueId)}`,
                  )}
                  className="type-body min-w-0 truncate text-brand-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
                >
                  <span translate="no" className="type-mono-value">
                    {point.issueId}
                  </span>
                  <span className="ml-2">{point.title}</span>
                </Link>
                <span className="shrink-0 type-mono-value text-destructive-text">
                  {t("elapsedDays", {
                    days: formatDays(point.elapsedDays, locale),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function FlowStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-12 flex-col justify-between gap-1 rounded-md bg-surface-hover px-2.5 py-2">
      <dt className="type-caption truncate text-muted-foreground">{label}</dt>
      <dd className="type-mono-value font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function formatDays(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value / 100);
}
