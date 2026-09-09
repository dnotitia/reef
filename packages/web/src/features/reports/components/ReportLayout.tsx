"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { CBX_CHEVRON, CBX_TRIGGER_FIELD } from "@/components/ui/comboboxChrome";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import {
  useEnrichmentEmptyLabels,
  useFieldNameLabels,
} from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export function PageShell({
  description,
  actions,
  children,
}: {
  /** Active workspace name, shown as the header subtitle so Reports names its
   *  vault scope like the Issues / Planning / Activity headers do (REEF-260). */
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const nav = useTranslations("nav");
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={nav("reports")}
        description={description}
        actions={actions}
      />
      <PageBody width="wide" className="flex flex-col gap-6">
        {children}
      </PageBody>
    </div>
  );
}

export function Card({
  title,
  subtitle,
  testId,
  children,
}: {
  title: string;
  subtitle?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={
        testId ?? `report-card-${title.toLowerCase().replace(/\s+/g, "-")}`
      }
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-4"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="type-body font-semibold text-foreground">{title}</h3>
        {subtitle && (
          <span className="type-card-metadata text-muted-foreground">
            {subtitle}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

/**
 * A labeled band that groups a set of report cards under one quiet section
 * heading (Snapshot / Flow & forecast / Breakdown). The label is the page's
 * scan anchor: it segments a long uniform scroll into a few named groups so the
 * eye has an entry point and the cards stop reading as one flat wall (REEF-248).
 * Intentionally low-chrome — just an uppercase muted heading, no box — so it adds
 * hierarchy without competing with the cards it introduces. The page stacks
 * sections with more space than cards carry within a section, so the grouping
 * reads from rhythm as well as from the labels.
 */
export function ReportSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="type-report-section text-muted-foreground">{label}</h2>
      {children}
    </section>
  );
}

// Stable React keys for the fixed-count placeholder groups (avoids index-as-key).
const SCOPE_CONTROL_KEYS = Array.from({ length: 8 }, (_, i) => `scope-${i}`);
const KPI_TILE_KEYS = Array.from({ length: 8 }, (_, i) => `kpi-${i}`);
const BREAKDOWN_CARD_KEYS = [
  "workflow",
  "deadlines",
  "byType",
  "topAssignees",
  "topLabels",
] as const;

function StaticReportControl({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      className={cn(CBX_TRIGGER_FIELD, className)}
      data-fixed-report-control="true"
    >
      <span className="min-w-0 truncate">{label}</span>
      <ChevronDown aria-hidden="true" className={CBX_CHEVRON} />
    </span>
  );
}

function StaticReportLabel({ label }: { label: string }) {
  return (
    <span
      data-typography-role="snapshot-label"
      className="type-snapshot-label truncate text-muted-foreground"
    >
      {label}
    </span>
  );
}

/** Card placeholder matching {@link Card}'s frame (rounded border + p-4) with a
 *  header bar and a body block, so a report card hydrating in does not resize
 *  its slot. `bodyHeight` approximates the loaded chart/list height. */
function ReportCardSkeleton({
  title,
  bodyHeight,
  bodyLabels = [],
}: {
  title: string;
  bodyHeight: string;
  bodyLabels?: readonly string[];
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-card p-4">
      <h3 className="type-body font-semibold text-foreground">{title}</h3>
      {bodyLabels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 type-card-metadata text-muted-foreground">
          {bodyLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      ) : null}
      <div aria-hidden="true">
        <Skeleton className={`${bodyHeight} w-full`} />
      </div>
    </section>
  );
}

/**
 * First-paint skeleton for the reports page. Mirrors the loaded page's structure
 * so the body does not shift when the real cards hydrate (REEF-258): the
 * {@link ReportScopeBar}'s control grid (was missing entirely → the whole page
 * dropped a row when it appeared), the KPI grid at the loaded `lg:grid-cols-5`
 * with all eight tiles (was `lg:grid-cols-6` × 6 → one row vs two), and the same
 * three labeled {@link ReportSection} bands (Snapshot / Flow & forecast /
 * Breakdown) with `gap-10` between them (was a flat `gap-6` with no headings).
 * The section labels are static page chrome, so rendering them for real keeps
 * the band headers pixel-identical across the skeleton↔loaded swap.
 */
export function ReportsSkeleton() {
  const t = useTranslations("reports.page");
  const cards = useTranslations("reports.cards");
  const c = useTranslations("common");
  const fieldNames = useFieldNameLabels();
  const empty = useEnrichmentEmptyLabels();
  const scopeLabels = [
    t("period"),
    t("scope"),
    t("measure"),
    fieldNames.sprint,
    fieldNames.milestone,
    fieldNames.release,
    fieldNames.assignee,
    fieldNames.labels,
  ] as const;
  const kpiLabels = [
    t("atRisk"),
    t("overdue"),
    t("stale"),
    t("blocked"),
    t("active"),
    t("inProgress"),
    t("done"),
    empty.unassigned,
  ] as const;
  return (
    <div className="flex flex-col gap-6" data-testid="reports-skeleton">
      {/* screen-reader loading announcement (REEF-281). The wrapping PageShell owns
          the page header; the section band headings below stay real headings,
          so the placeholder clusters take aria-hidden. */}
      <output className="sr-only">{c("loading")}</output>
      {/* Scope bar — same auto-fit control grid as ReportScopeBar (8 controls). */}
      <div
        data-testid="reports-skeleton-scope-bar"
        className="grid w-full grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-2 rounded-lg border border-border-subtle bg-surface-subtle p-2"
        role="group"
        aria-label={t("scope")}
        aria-busy="true"
      >
        {SCOPE_CONTROL_KEYS.map((key, index) => (
          <StaticReportControl
            key={key}
            label={scopeLabels[index] ?? t("scope")}
            className="h-8 w-full"
          />
        ))}
      </div>

      <div className="flex flex-col gap-10">
        <ReportSection label={t("snapshot")}>
          <div className="flex flex-col gap-4">
            {/* KPI grid — lg:grid-cols-5 × 8 tiles (matches HealthSummary). */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {KPI_TILE_KEYS.map((key, index) => (
                <div
                  key={key}
                  className="flex min-h-[76px] flex-col justify-between gap-1 rounded-lg border border-border-subtle bg-surface-card p-3"
                >
                  <StaticReportLabel label={kpiLabels[index] ?? t("active")} />
                  <Skeleton aria-hidden="true" className="h-6 w-10" />
                </div>
              ))}
            </div>
          </div>
        </ReportSection>

        <ReportSection label={t("flowForecast")}>
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <ReportCardSkeleton title={t("riskMap")} bodyHeight="h-40" />
              <ReportCardSkeleton title={t("throughput")} bodyHeight="h-40" />
            </div>
            <ReportCardSkeleton
              title={cards("flowMetrics")}
              bodyHeight="h-64"
              bodyLabels={[cards("cycleTime"), cards("leadTime")]}
            />
            {/* Forecast + custom pivot, both full width. */}
            <ReportCardSkeleton
              title={cards("deliveryForecast")}
              bodyHeight="h-32"
            />
            <ReportCardSkeleton
              title={cards("pivot")}
              bodyHeight="h-32"
              bodyLabels={[cards("rows"), cards("columns")]}
            />
          </div>
        </ReportSection>

        <ReportSection label={t("breakdown")}>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {BREAKDOWN_CARD_KEYS.map((key) => (
              <ReportCardSkeleton key={key} title={t(key)} bodyHeight="h-28" />
            ))}
          </div>
        </ReportSection>
      </div>
    </div>
  );
}
