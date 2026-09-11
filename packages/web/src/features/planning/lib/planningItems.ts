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

/**
 * Pick the current sprint using the same deterministic tie-break as the
 * server's active-sprint default: latest start date, then highest id.
 */
export function selectActiveSprint(sprints: readonly Sprint[]): Sprint | null {
  let current: Sprint | null = null;
  for (const sprint of sprints) {
    if (sprint.status !== "active") continue;
    if (current === null) {
      current = sprint;
      continue;
    }
    const sprintStart = sprint.start_date?.trim() ?? "";
    const currentStart = current.start_date?.trim() ?? "";
    if (
      sprintStart > currentStart ||
      (sprintStart === currentStart && sprint.id > current.id)
    ) {
      current = sprint;
    }
  }
  return current;
}

function compareIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareTargetDates(
  left: { target_date?: string | null },
  right: { target_date?: string | null },
): number {
  const leftDate = left.target_date?.trim() || null;
  const rightDate = right.target_date?.trim() || null;
  if (leftDate === null && rightDate !== null) return 1;
  if (leftDate !== null && rightDate === null) return -1;
  if (leftDate !== null && rightDate !== null && leftDate !== rightDate) {
    return leftDate < rightDate ? -1 : 1;
  }
  return 0;
}

/**
 * Select open milestones for the Planning Overview in a stable order.
 *
 * The catalog is a server/cache boundary, so callers need to be able to pass its
 * arrays directly without having their order changed. `filter` creates the
 * working array before sorting it, and ids use code-point comparisons instead
 * of locale-sensitive collation.
 */
export function upcomingMilestones(
  milestones: readonly Milestone[],
): Milestone[] {
  return milestones
    .filter((milestone) => milestone.status === "open")
    .sort((left, right) => {
      const byDate = compareTargetDates(left, right);
      return byDate === 0 ? compareIds(left.id, right.id) : byDate;
    });
}

/** Select planned or in-progress releases for the Planning Overview. */
export function upcomingReleases(releases: readonly Release[]): Release[] {
  return releases
    .filter(
      (release) =>
        release.status === "planned" || release.status === "in_progress",
    )
    .sort((left, right) => {
      const byDate = compareTargetDates(left, right);
      if (byDate !== 0) return byDate;

      if (left.status !== right.status) {
        return left.status === "in_progress" ? -1 : 1;
      }
      return compareIds(left.id, right.id);
    });
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
