"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
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
        <section
          key={section}
          className={cn(
            "grid min-w-0",
            section === "currentSprint" ? "gap-3" : "gap-2",
          )}
        >
          <h2
            className={cn(
              section === "currentSprint"
                ? "type-group-title text-foreground"
                : "type-section-label text-muted-foreground",
            )}
          >
            {t(section)}
          </h2>
          <div
            className="grid min-w-0 gap-3"
            aria-hidden="true"
            data-testid={`planning-overview-skeleton-${section}`}
          >
            <div
              className={cn(
                "grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(14rem,32rem)] md:items-center",
                section === "currentSprint"
                  ? "rounded-lg border border-border bg-surface-card p-4"
                  : "rounded-md border border-border-subtle bg-surface-subtle p-3",
              )}
            >
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
