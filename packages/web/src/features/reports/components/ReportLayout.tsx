"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import type { ReactNode } from "react";

export function PageShell({
  description,
  children,
}: {
  /** Active workspace name, shown as the header subtitle so Reports names its
   *  vault scope like the Issues / Planning / Activity headers do (REEF-260). */
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Reports" description={description} />
      <PageBody width="wide" className="flex flex-col gap-6">
        {children}
      </PageBody>
    </div>
  );
}

export function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={`report-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-4"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && (
          <span className="text-[11px] text-muted-foreground">{subtitle}</span>
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
      <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </h2>
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="reports-empty"
      className="rounded-lg border border-dashed border-border-subtle bg-surface-subtle px-6 py-12 text-center"
    >
      {children}
    </div>
  );
}

// Stable React keys for the fixed-count placeholder groups (avoids index-as-key).
const SCOPE_CONTROL_KEYS = Array.from({ length: 8 }, (_, i) => `scope-${i}`);
const KPI_TILE_KEYS = Array.from({ length: 8 }, (_, i) => `kpi-${i}`);
const BREAKDOWN_CARD_KEYS = Array.from(
  { length: 6 },
  (_, i) => `breakdown-${i}`,
);

/** Card placeholder matching {@link Card}'s frame (rounded border + p-4) with a
 *  header bar and a body block, so a report card hydrating in does not resize
 *  its slot. `bodyHeight` approximates the loaded chart/list height. */
function ReportCardSkeleton({ bodyHeight }: { bodyHeight: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-4">
      <Skeleton tone="secondary" className="h-4 w-24" />
      <Skeleton className={`${bodyHeight} w-full`} />
    </div>
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
  return (
    <div className="flex flex-col gap-6">
      {/* Scope bar — same auto-fit control grid as ReportScopeBar (8 controls). */}
      <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-2 rounded-lg border border-border-subtle bg-surface-subtle p-2">
        {SCOPE_CONTROL_KEYS.map((key) => (
          <Skeleton key={key} tone="secondary" className="h-8 w-full" />
        ))}
      </div>

      <div className="flex flex-col gap-10">
        <ReportSection label="Snapshot">
          <div className="flex flex-col gap-4">
            {/* KPI grid — lg:grid-cols-5 × 8 tiles (matches HealthSummary). */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {KPI_TILE_KEYS.map((key) => (
                <div
                  key={key}
                  className="flex min-h-[76px] flex-col justify-between gap-1 rounded-lg border border-border-subtle bg-surface-subtle p-3"
                >
                  <Skeleton tone="secondary" className="h-3 w-14" />
                  <Skeleton className="h-6 w-10" />
                </div>
              ))}
            </div>
            {/* Per-item RAG rollup card. */}
            <ReportCardSkeleton bodyHeight="h-28" />
          </div>
        </ReportSection>

        <ReportSection label="Flow & forecast">
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <ReportCardSkeleton bodyHeight="h-40" />
              <ReportCardSkeleton bodyHeight="h-40" />
            </div>
            {/* Forecast + custom pivot, both full width. */}
            <ReportCardSkeleton bodyHeight="h-32" />
            <ReportCardSkeleton bodyHeight="h-32" />
          </div>
        </ReportSection>

        <ReportSection label="Breakdown">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {BREAKDOWN_CARD_KEYS.map((key) => (
              <ReportCardSkeleton key={key} bodyHeight="h-28" />
            ))}
          </div>
        </ReportSection>
      </div>
    </div>
  );
}
