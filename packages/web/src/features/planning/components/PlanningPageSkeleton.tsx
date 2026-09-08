"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { useFieldNameLabels, usePlanningKindLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

function LabeledSkeleton({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <div className={cn("relative inline-flex min-w-0", className)}>
      <Skeleton
        aria-hidden="true"
        tone="secondary"
        className={cn("absolute inset-0", className)}
      />
      <span className="relative z-[1] min-w-0 truncate px-2 type-segmented-control font-medium text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

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
  const planning = useTranslations("planning");
  const sections = useTranslations("sections");
  const kindLabels = usePlanningKindLabels();
  const fieldNames = useFieldNameLabels();
  return (
    <div className="flex h-full flex-col" data-testid="planning-skeleton">
      <PageHeader title={nav("planning")} />
      <PageBody pad="compact">
        {/* screen-reader loading announcement (REEF-281), sibling to the decorative
            body; PageHeader's h1 stays a real heading. */}
        <output className="sr-only">{common("loading")}</output>
        <div>
          {/* Kind toggle group placeholder (Sprints / Milestones / Releases). */}
          <div className="mb-4 inline-flex gap-1 rounded-md border border-border-subtle bg-surface-elevated p-0.5">
            {(["sprints", "milestones", "releases"] as const).map((kind) => (
              <LabeledSkeleton
                key={kind}
                label={kindLabels[kind]}
                className="h-8 w-24"
              />
            ))}
          </div>
          {/* Table header + rows — fixed headings are shared with PlanningTable;
              item names, values, and row count stay unknown until the catalog
              query resolves. */}
          <div data-testid="planning-skeleton-table" className="flex flex-col">
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 border-b border-border-subtle px-3 py-2 type-table-header text-muted-foreground">
              <span>{planning("name")}</span>
              <span>{fieldNames.status}</span>
              <span>{planning("dates")}</span>
              <span>{planning("issues")}</span>
              <span>{sections("details")}</span>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <Skeleton aria-hidden="true" className="h-10 w-full" />
              <Skeleton aria-hidden="true" className="h-10 w-full" />
              <Skeleton aria-hidden="true" className="h-10 w-11/12" />
            </div>
          </div>
        </div>
      </PageBody>
    </div>
  );
}
