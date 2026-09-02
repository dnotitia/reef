import type { Milestone, PlanningCatalog, Release, Sprint } from "@reef/core";

// Kind keys are canonical in `@reef/core/fields/planning` (single source shared
// with the `PlanningKindIcon` glyph leaf). The kind type is re-exported so the
// many existing planning consumers keep their import path unchanged. Human kind
// labels are locale-resolved through `@/i18n/fieldLabels`
// (`usePlanningKindLabels` / `usePlanningKindSingularLabels`), not re-exported
// as English literals (REEF-292).
export type { PlanningKind } from "@reef/core/fields/planning";
import type { PlanningKind } from "@reef/core/fields/planning";

export type PlanningItem = Sprint | Milestone | Release;

export function itemsForKind(
  catalog: PlanningCatalog | undefined,
  kind: PlanningKind,
): PlanningItem[] {
  if (!catalog) return [];
  if (kind === "sprints") return catalog.sprints;
  if (kind === "milestones") return catalog.milestones;
  return catalog.releases;
}

export function findPlanningName(
  catalog: PlanningCatalog | undefined,
  kind: PlanningKind,
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  return (
    itemsForKind(catalog, kind).find((item) => item.id === id)?.name ?? null
  );
}

export function isAssignablePlanningItem(
  kind: PlanningKind,
  item: PlanningItem,
): boolean {
  if (kind === "sprints")
    return item.status === "planned" || item.status === "active";
  if (kind === "milestones") return item.status === "open";
  return item.status === "planned" || item.status === "in_progress";
}
