"use client";

import {
  SEGMENTED_CONTROL_ITEM,
  SEGMENTED_CONTROL_ITEM_ACTIVE,
  SEGMENTED_CONTROL_ITEM_INACTIVE,
  SEGMENTED_CONTROL_TRACK,
} from "@/components/segmentedControl";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { usePlanningKindSingularLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import { LayoutDashboard, List as ListIcon, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { PlanningOverviewSkeleton } from "./PlanningOverviewSkeleton";
import { SprintRolloverPendingSkeleton } from "./SprintRolloverPendingSkeleton";

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
  const planningKindSingular = usePlanningKindSingularLabels();
  return (
    <div className="flex h-full flex-col" data-testid="planning-skeleton">
      <PageHeader
        title={nav("planning")}
        staticTitleAdjacent={
          <div
            role="group"
            aria-label={planning("planningView")}
            data-testid="planning-view-switcher"
            className={SEGMENTED_CONTROL_TRACK}
          >
            <span
              data-testid="planning-view-overview"
              className={cn(
                SEGMENTED_CONTROL_ITEM,
                SEGMENTED_CONTROL_ITEM_ACTIVE,
              )}
            >
              <LayoutDashboard
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0"
              />
              {planning("view.overview")}
            </span>
            <span
              data-testid="planning-view-list"
              className={cn(
                SEGMENTED_CONTROL_ITEM,
                SEGMENTED_CONTROL_ITEM_INACTIVE,
              )}
            >
              <ListIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              {planning("view.list")}
            </span>
          </div>
        }
        staticActions={
          <span
            aria-hidden="true"
            data-testid="planning-static-new-action"
            className="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-foreground px-3 type-control font-medium text-surface-page"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            {planning("newKind", {
              kind: planningKindSingular.sprints.toLowerCase(),
            })}
          </span>
        }
        staticDescription={
          <span
            aria-hidden="true"
            className="reef-shimmer inline-block h-3 w-16 rounded-md"
          />
        }
      />
      <PageBody pad="compact">
        {/* screen-reader loading announcement (REEF-281), sibling to the decorative
            body; PageHeader's h1 stays a real heading. */}
        <output className="sr-only">{common("loading")}</output>
        <div>
          <SprintRolloverPendingSkeleton />
          <PlanningOverviewSkeleton />
        </div>
      </PageBody>
    </div>
  );
}
