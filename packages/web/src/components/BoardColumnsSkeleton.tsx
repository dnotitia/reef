import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { WORKFLOW_STATUS_OPTIONS } from "@reef/core/fields";

/**
 * Placeholder for the board's workflow-status columns. Shared by the live
 * board's pending state (KanbanBoard) and the first-paint app shell
 * (AppShellSkeleton) so both render the same column frame. (REEF-097)
 */
interface BoardColumnsSkeletonProps {
  className?: string;
  ariaLabel?: string;
}

export function BoardColumnsSkeleton({
  ariaLabel,
  className,
}: BoardColumnsSkeletonProps) {
  return (
    <div
      data-testid="board-columns-skeleton"
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto px-6 py-4",
        className,
      )}
      role={ariaLabel ? "region" : undefined}
      aria-label={ariaLabel}
      tabIndex={ariaLabel ? 0 : undefined}
    >
      {WORKFLOW_STATUS_OPTIONS.map((status) => (
        <Skeleton key={status} className="h-64 w-80 shrink-0" />
      ))}
    </div>
  );
}
