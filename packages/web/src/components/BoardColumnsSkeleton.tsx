import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { WORKFLOW_STATUS_OPTIONS } from "@reef/core/fields";

/**
 * Placeholder for the board's workflow-status columns. Shared by the live
 * board's pending state (KanbanBoard) and the first-paint app shell
 * (AppShellSkeleton) so both render the same column frame. (REEF-097)
 */
export function BoardColumnsSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex gap-3 px-6 py-4", className)}>
      {WORKFLOW_STATUS_OPTIONS.map((status) => (
        <Skeleton key={status} className="h-64 w-80 shrink-0" />
      ))}
    </div>
  );
}
