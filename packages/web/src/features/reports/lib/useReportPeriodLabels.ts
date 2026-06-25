"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { ReportPeriod } from "./aggregateModel";

/**
 * Locale-aware throughput-period labels (REEF-304). The window names the period
 * control and the Throughput-card subtitle follow the active locale
 * too — otherwise a Korean report reads "Last 12 weeks · 순증 +3" (the
 * half-translated string REEF-298 removes). Mirrors the `PERIOD_LABELS` record
 * shape so call sites keep their `labels[period]` lookup; the en values match
 * `PERIOD_LABELS` exactly, so English output is unchanged.
 */
const REPORT_PERIODS: readonly ReportPeriod[] = ["4w", "12w", "quarter", "all"];

export function useReportPeriodLabels(): Record<ReportPeriod, string> {
  const t = useTranslations("reports.period");
  return useMemo(() => {
    const out = {} as Record<ReportPeriod, string>;
    for (const period of REPORT_PERIODS) out[period] = t(period);
    return out;
  }, [t]);
}
