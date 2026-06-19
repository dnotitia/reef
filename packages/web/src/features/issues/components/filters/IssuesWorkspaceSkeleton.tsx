import { BoardColumnsSkeleton } from "@/components/BoardColumnsSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/features/ui/components/PageHeader";

/**
 * First-paint skeleton for the issues workspace, shared by the route's
 * `loading.tsx` (soft-nav segment fetch) and the page's `<Suspense fallback>`
 * (the `useSearchParams` CSR bail-out on a hard navigation / refresh / deep
 * link). Without a fallback that boundary renders `null`, so the body painted
 * blank until hydration — the gap REEF-255 closes.
 *
 * A cold hit carries no `?view=`, so this mirrors the default Board view: the
 * same {@link BoardColumnsSkeleton} the live board shows while pending
 * (REEF-097), so the route fallback and the hydrated pending state read
 * identically. The header + toolbar bar hold their heights so the real chrome
 * does not shove the board down when it hydrates in.
 */
export function IssuesWorkspaceSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="issues-skeleton">
      <PageHeader title="Issues" />
      {/* Mirrors IssueFilterToolbar's outer bar (border-b · px-6 · py-2.5) so
          the toolbar appearing on hydration is not a vertical jump. */}
      <div className="flex flex-col gap-2 border-b border-border-subtle bg-background px-6 py-2.5">
        <div className="flex items-center gap-2">
          <Skeleton tone="secondary" className="h-7 w-24" />
          <Skeleton tone="secondary" className="h-7 w-20" />
          <Skeleton tone="secondary" className="ml-auto h-7 w-28" />
        </div>
      </div>
      <BoardColumnsSkeleton className="flex-1 overflow-hidden" />
    </div>
  );
}
