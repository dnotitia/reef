import { BoardColumnsSkeleton } from "@/components/BoardColumnsSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
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

/** Loading shape for the sprint detail route and its client Suspense boundary. */
export function SprintDetailPageSkeleton() {
  const common = useTranslations("common");
  const detail = useTranslations("planning.detail");
  return (
    <div
      data-testid="sprint-detail-skeleton"
      className="flex h-full min-h-0 min-w-0 flex-col"
    >
      <output className="sr-only">{common("loading")}</output>
      <header className="shrink-0 border-b border-border-subtle bg-surface-page px-6 py-3">
        <div
          aria-hidden="true"
          className="flex min-w-0 flex-wrap items-start justify-between gap-3"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <Skeleton className="size-7" />
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <div className="flex flex-wrap gap-3">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
          <Skeleton className="h-8 w-28" />
        </div>
        <Skeleton className="mt-3 h-9 w-full" />
      </header>
      <div
        data-testid="sprint-burnup-slot"
        data-slot="sprint-burnup"
        aria-label={detail("burnupSlot")}
        className="sr-only"
      />
      <div aria-hidden="true" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-2 border-b border-border-subtle bg-surface-page px-6 py-2.5">
          <Skeleton tone="secondary" className="h-9 w-full" />
          <div className="flex flex-wrap items-center gap-2">
            {FILTER_WIDTHS.map((width, index) => (
              <Skeleton
                key={`${width}-${index}`}
                tone="secondary"
                className={`h-8 ${width}`}
              />
            ))}
          </div>
        </div>
        <BoardColumnsSkeleton />
      </div>
    </div>
  );
}
