"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useFieldNameLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

const PLANNING_LOADING_ROWS = ["one", "two", "three"] as const;

/**
 * Responsive placeholder for the planning catalog. The live table switches
 * to `PlanningCompactList` below the desktop breakpoint; keeping the same
 * breakpoint and card frame here prevents a pending catalog from painting a
 * temporary horizontal table on narrow screens.
 *
 * Values and item names remain skeletons because the catalog is not known yet.
 * The field labels and card frame are fixed planning chrome, so they stay
 * readable in both responsive variants.
 */
export function PlanningTableSkeleton({
  desktopTestId = "planning-skeleton-table",
}: {
  desktopTestId?: string;
}) {
  const planning = useTranslations("planning");
  const sections = useTranslations("sections");
  const fieldNames = useFieldNameLabels();

  return (
    <>
      <div
        data-testid={desktopTestId}
        className="hidden min-w-0 flex-col lg:flex"
        aria-busy="true"
      >
        <div
          data-testid={`${desktopTestId}-header`}
          className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-border-subtle px-3 py-2 type-table-header text-muted-foreground"
        >
          <span>{planning("name")}</span>
          <span>{fieldNames.status}</span>
          <span>{planning("dates")}</span>
          <span>{planning("issues")}</span>
          <span>{sections("details")}</span>
          <span aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-2 pt-2" aria-hidden="true">
          {PLANNING_LOADING_ROWS.map((row) => (
            <Skeleton key={row} className="h-10 w-full" />
          ))}
        </div>
      </div>

      <div
        data-testid="planning-skeleton-compact-list"
        className="grid min-w-0 gap-3 lg:hidden"
        role="list"
        aria-busy="true"
      >
        <article
          data-testid="planning-skeleton-compact-item"
          className="min-w-0 rounded-md border border-border-subtle bg-surface-card p-3"
          role="listitem"
        >
          <div className="flex min-w-0 items-start justify-between gap-3">
            <Skeleton
              aria-hidden="true"
              className="h-4 min-w-0 flex-1 max-w-48"
            />
            <div
              className="flex shrink-0 items-center gap-1"
              aria-hidden="true"
            >
              <Skeleton className="h-7 w-7" />
              <Skeleton className="h-7 w-7" />
            </div>
          </div>

          <dl className="mt-3 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">{fieldNames.status}</dt>
            <dd className="min-w-0">
              <Skeleton aria-hidden="true" className="h-4 w-20" />
            </dd>
            <dt className="text-muted-foreground">{planning("dates")}</dt>
            <dd className="min-w-0">
              <Skeleton aria-hidden="true" className="h-4 w-36 max-w-full" />
            </dd>
            <dt className="text-muted-foreground">{planning("issues")}</dt>
            <dd className="min-w-0">
              <Skeleton aria-hidden="true" className="h-4 w-24" />
            </dd>
            <dt className="text-muted-foreground">{sections("details")}</dt>
            <dd className="min-w-0">
              <Skeleton aria-hidden="true" className="h-4 w-full" />
            </dd>
          </dl>
        </article>
      </div>
    </>
  );
}
