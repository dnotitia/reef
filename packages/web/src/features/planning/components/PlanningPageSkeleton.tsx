import { Skeleton } from "@/components/ui/skeleton";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { useTranslations } from "next-intl";

/**
 * Full-page Planning skeleton — page chrome (header + compact body) around the
 * kind-toggle bar and the table's row placeholders. Shared by the route's
 * `loading.tsx` (soft-nav segment fetch) and the page's `<Suspense fallback>`
 * (the `useSearchParams` CSR bail-out on a hard navigation), so neither paints a
 * blank body before hydration (REEF-255). PlanningTable keeps its own in-flight
 * skeleton for the catalog fetch once the page has mounted.
 */
export function PlanningPageSkeleton() {
  const nav = useTranslations("nav");
  const common = useTranslations("common");
  return (
    <div className="flex h-full flex-col" data-testid="planning-skeleton">
      <PageHeader title={nav("planning")} />
      <PageBody pad="compact">
        {/* screen-reader loading announcement (REEF-281), sibling to the decorative
            body; PageHeader's h1 stays a real heading. */}
        <output className="sr-only">{common("loading")}</output>
        <div aria-hidden="true">
          {/* Kind toggle group placeholder (Sprints / Milestones / Releases). */}
          <div className="mb-4 inline-flex gap-1 rounded-md border border-border-subtle bg-elevated p-0.5">
            {[0, 1, 2].map((i) => (
              <Skeleton
                key={`kind-${i}`}
                tone="secondary"
                className="h-8 w-24"
              />
            ))}
          </div>
          {/* Table rows — mirrors PlanningTable's own pending placeholder. */}
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-11/12" />
          </div>
        </div>
      </PageBody>
    </div>
  );
}
