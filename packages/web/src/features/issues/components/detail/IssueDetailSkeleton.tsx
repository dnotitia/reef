import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton placeholder for IssueDetail while the issue is loading.
 * Matches the IssueDetail layout: title, metadata row, body area.
 */
export function IssueDetailSkeleton() {
  return (
    <div
      data-testid="issue-detail-skeleton"
      className="flex flex-col gap-4 p-6"
    >
      {/* Title skeleton */}
      <Skeleton className="h-7 w-3/4" />

      {/* Metadata row skeleton */}
      <div className="flex gap-3">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-24" />
      </div>

      {/* Labels skeleton */}
      <Skeleton className="h-5 w-40" />

      {/* Body skeleton */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}
