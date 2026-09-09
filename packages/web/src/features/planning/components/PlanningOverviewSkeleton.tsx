"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "next-intl";

const SECTIONS = [
  "currentSprint",
  "upcomingMilestones",
  "upcomingReleases",
] as const;

export function PlanningOverviewSkeleton() {
  const t = useTranslations("planning.overview");

  return (
    <div
      data-testid="planning-overview-loading"
      className="grid min-w-0 gap-6"
      aria-busy="true"
    >
      {SECTIONS.map((section) => (
        <section key={section} className="grid min-w-0 gap-3">
          <h2 className="type-section-label text-muted-foreground">
            {t(section)}
          </h2>
          <div
            className="grid min-w-0 gap-3"
            aria-hidden="true"
            data-testid={`planning-overview-skeleton-${section}`}
          >
            <div className="grid min-w-0 gap-3 rounded-lg border border-border-subtle bg-surface-card p-4 md:grid-cols-[minmax(0,1fr)_minmax(14rem,32rem)] md:items-center">
              <div className="grid min-w-0 gap-3">
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-4 w-40 max-w-full" />
              </div>
              <div className="grid min-w-0 gap-2">
                <Skeleton className="h-4 w-28 max-w-full" />
                <Skeleton className="h-1.5 w-full" />
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
