"use client";

import { BoardColumnsSkeleton } from "@/components/BoardColumnsSkeleton";
import {
  SEGMENTED_CONTROL_ITEM,
  SEGMENTED_CONTROL_ITEM_ACTIVE,
  SEGMENTED_CONTROL_ITEM_INACTIVE,
  SEGMENTED_CONTROL_TRACK,
} from "@/components/segmentedControl";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

const FILTER_WIDTHS = [
  "w-20",
  "w-16",
  "w-20",
  "w-20",
  "w-14",
  "w-24",
  "w-36",
  "w-36",
  "w-36",
  "w-36",
  "w-36",
  "w-36",
  "w-24",
] as const;

function StaticViewControl({
  labels,
  ariaLabel,
}: {
  labels: readonly string[];
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      aria-busy="true"
      className={SEGMENTED_CONTROL_TRACK}
    >
      {labels.map((label, index) => (
        <span
          key={label}
          className={cn(
            SEGMENTED_CONTROL_ITEM,
            index === 0
              ? SEGMENTED_CONTROL_ITEM_ACTIVE
              : SEGMENTED_CONTROL_ITEM_INACTIVE,
          )}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

/** Loading shape for the sprint detail route and its client Suspense boundary. */
export function SprintDetailPageSkeleton() {
  const common = useTranslations("common");
  const detail = useTranslations("planning.detail");
  const filters = useTranslations("issues.filters");
  return (
    <div
      data-testid="sprint-detail-skeleton"
      className="flex h-full min-h-0 min-w-0 flex-col"
    >
      <output className="sr-only">{common("loading")}</output>
      <header className="shrink-0 border-b border-border-subtle bg-surface-page px-6 py-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <Skeleton aria-hidden="true" className="size-7" />
              <Skeleton aria-hidden="true" className="h-5 w-56" />
              <Skeleton aria-hidden="true" className="h-5 w-20 rounded-full" />
            </div>
            <div className="flex flex-wrap gap-3">
              <Skeleton aria-hidden="true" className="h-4 w-44" />
              <Skeleton aria-hidden="true" className="h-4 w-16" />
              <Skeleton aria-hidden="true" className="h-5 w-24 rounded-full" />
              <Skeleton aria-hidden="true" className="h-4 w-28" />
            </div>
          </div>
          <StaticViewControl
            ariaLabel={filters("issueView")}
            labels={[filters("view.board"), filters("view.list")]}
          />
        </div>
        <div className="mt-3 flex min-w-0 items-center gap-2 rounded-md border border-border-subtle bg-surface-subtle px-3 py-2 type-control font-medium text-foreground">
          <span className="shrink-0 text-muted-foreground">
            {detail("goal")}
          </span>
          <Skeleton aria-hidden="true" className="h-4 min-w-0 flex-1" />
        </div>
      </header>
      <div
        data-testid="sprint-burnup-slot"
        data-slot="sprint-burnup"
        aria-label={detail("burnupSlot")}
        className="sr-only"
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-2 border-b border-border-subtle bg-surface-page px-6 py-2.5">
          <Skeleton
            aria-hidden="true"
            tone="secondary"
            className="h-9 w-full"
          />
          <div className="flex flex-wrap items-center gap-2">
            {FILTER_WIDTHS.map((width, index) => (
              <Skeleton
                key={`${width}-${index}`}
                aria-hidden="true"
                tone="secondary"
                className={`h-8 ${width}`}
              />
            ))}
          </div>
        </div>
        <BoardColumnsSkeleton scope="active" groupBy="status" />
      </div>
    </div>
  );
}
