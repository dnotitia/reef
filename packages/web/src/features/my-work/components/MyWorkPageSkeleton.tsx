import { Skeleton } from "@/components/ui/skeleton";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";

/**
 * Body skeleton for My Work: the summary tile strip over the focus queue. Shared
 * by {@link MyWorkPage}'s in-flight branches and the full-page
 * {@link MyWorkPageSkeleton} so the route fallback and the data-loading state
 * render the same placeholder (REEF-255).
 */
export function MyWorkSkeleton() {
  return (
    <div className="flex flex-col gap-6" data-testid="my-work-skeleton">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={`tile-${i}`}
            className="flex min-h-[78px] flex-col justify-between gap-2 rounded-lg border border-border-subtle bg-surface-subtle p-3"
          >
            <Skeleton tone="secondary" className="h-3 w-16" />
            <Skeleton className="h-6 w-10" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 rounded-xl border border-border-subtle p-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={`row-${i}`} className="h-7 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * Full-page My Work skeleton — the page chrome (header + body region) around the
 * {@link MyWorkSkeleton}. Used by the route's `loading.tsx` (soft-nav) and the
 * page's `<Suspense fallback>` (the `useSearchParams` CSR bail-out on a hard
 * navigation), so neither path paints a blank body before hydration (REEF-255).
 */
export function MyWorkPageSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="My Work" />
      <PageBody width="wide" className="flex flex-col gap-6">
        <MyWorkSkeleton />
      </PageBody>
    </div>
  );
}
