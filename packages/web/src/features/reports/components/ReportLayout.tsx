"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import type { ReactNode } from "react";

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Reports" />
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

export function ReportsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={`kpi-skeleton-${i}`}
            className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-subtle p-3"
          >
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-6 w-10" />
          </div>
        ))}
      </div>
      {[0, 1].map((i) => (
        <div
          key={`wide-skeleton-${i}`}
          className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-4"
        >
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={`reports-skeleton-${i}`}
            className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-4"
          >
            <Skeleton className="h-4 w-24" />
            <div className="flex flex-col gap-1.5">
              {[0, 1, 2, 3].map((j) => (
                <Skeleton
                  key={`reports-skeleton-${i}-${j}`}
                  className="h-4 w-full"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
