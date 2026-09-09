"use client";

import { PlanningKindIcon } from "@/components/fields/PlanningKindIcon";
import {
  SEGMENTED_CONTROL_ITEM,
  SEGMENTED_CONTROL_ITEM_ACTIVE,
  SEGMENTED_CONTROL_ITEM_INACTIVE,
  SEGMENTED_CONTROL_TRACK,
} from "@/components/segmentedControl";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { usePlanningKindLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { PLANNING_KINDS } from "./planningPageUtils";
import { PlanningTableSkeleton } from "./PlanningTableSkeleton";

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
  const kindLabels = usePlanningKindLabels();
  return (
    <div className="flex h-full flex-col" data-testid="planning-skeleton">
      <PageHeader title={nav("planning")} />
      <PageBody pad="compact">
        {/* screen-reader loading announcement (REEF-281), sibling to the decorative
            body; PageHeader's h1 stays a real heading. */}
        <output className="sr-only">{common("loading")}</output>
        <div>
          {/* Kind toggle group placeholder (Sprints / Milestones / Releases). */}
          <div
            className={cn("mb-4", SEGMENTED_CONTROL_TRACK)}
            role="group"
            aria-label={planning("planningKind")}
            data-testid="planning-kind-switcher"
          >
            {PLANNING_KINDS.map((kind, index) => (
              <span
                key={kind}
                data-testid={`planning-kind-${kind}`}
                className={cn(
                  SEGMENTED_CONTROL_ITEM,
                  index === 0
                    ? SEGMENTED_CONTROL_ITEM_ACTIVE
                    : SEGMENTED_CONTROL_ITEM_INACTIVE,
                )}
              >
                <PlanningKindIcon kind={kind} decorative size={14} />
                {kindLabels[kind]}
              </span>
            ))}
          </div>
          {/* The catalog body follows the same desktop-table / narrow-card
              breakpoint as the loaded PlanningTable. */}
          <PlanningTableSkeleton />
        </div>
      </PageBody>
    </div>
  );
}
