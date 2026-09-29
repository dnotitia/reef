"use client";

import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROWS = [
  { id: "one", className: "h-9 w-full" },
  { id: "two", className: "h-9 w-11/12" },
  { id: "three", className: "h-9 w-10/12" },
  { id: "four", className: "h-9 w-9/12" },
] as const;

export function TimelineGridSkeleton() {
  return (
    <div
      data-testid="timeline-grid-skeleton"
      className="flex h-full min-h-0 flex-col gap-2 px-6 py-4"
      aria-hidden="true"
    >
      <Skeleton className="h-10 w-full" />
      {SKELETON_ROWS.map(({ id, className }) => (
        <Skeleton key={id} className={className} />
      ))}
    </div>
  );
}

export function TimelineViewSkeleton() {
  return (
    <div
      data-testid="timeline-view-skeleton"
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-subtle px-6 py-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-8 w-44" />
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <TimelineGridSkeleton />
      </div>
    </div>
  );
}
