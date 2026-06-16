import type {
  IssueListItem,
  Milestone,
  PlanningCatalog,
  Release,
  Sprint,
} from "@reef/core";

// Kind keys and labels are canonical in `@reef/core/fields/planning` (single
// source shared with the `PlanningKindIcon` glyph leaf). Re-exported here so the
// many existing planning consumers keep their import path unchanged.
export {
  PLANNING_KIND_LABELS,
  PLANNING_KIND_SINGULAR,
  type PlanningKind,
} from "@reef/core/fields/planning";
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
 * Count issues per planning item for one kind in a single pass.
 *
 * Replaces a per-row `issues.filter().length` (O(items × issues)) with one
 * O(issues) build; callers then read each item's count via Map.get (O(1)).
 * Issues whose planning id is unset are skipped.
 */
export function countIssuesByPlanningId(
  issues: readonly IssueListItem[],
  kind: PlanningKind,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const id =
      kind === "sprints"
        ? issue.sprint_id
        : kind === "milestones"
          ? issue.milestone_id
          : issue.release_id;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
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
