import { Skeleton } from "@/components/ui/skeleton";

/**
 * Reserves the responsive frame occupied by a visible rollover nudge while a
 * protected surface is waiting for auth. The catalog and issue data are
 * intentionally unavailable in that state, so this inert placeholder keeps
 * the fixed content frame from jumping when the nudge resolves.
 */
export function SprintRolloverPendingSkeleton() {
  return (
    <div
      data-testid="sprint-rollover-pending-skeleton"
      aria-hidden="true"
      className="mb-3 flex h-[132px] shrink-0 flex-col items-stretch gap-2 rounded-md border border-border-subtle bg-surface-subtle/60 px-3 py-2.5 sm:h-[60px] sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:pr-12"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2 pr-10">
        <Skeleton className="h-10 w-3/4 max-w-64 sm:h-4" />
        <div className="flex flex-col gap-0.5">
          <Skeleton className="h-3 w-full max-w-80" />
          <Skeleton className="h-3 w-3/4 max-w-64 sm:hidden" />
        </div>
      </div>
      <Skeleton className="h-8 w-full shrink-0 sm:w-28" />
    </div>
  );
}
