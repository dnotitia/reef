import type { IssueListItem, Status } from "../schemas/issues/metadata";
import type { Milestone, Release, Sprint } from "../schemas/planning/catalog";
import type { PlanningKind } from "../schemas/planning/fieldRegistry";

export type PlanningRollupItem = Sprint | Milestone | Release;

export interface PlanningRollup {
  /** Number of issues linked to the planning item. */
  total: number;
  /** Issues in the done/closed lifecycle buckets. */
  completed: number;
  /** Issues in the in_progress/in_review lifecycle buckets. */
  inProgress: number;
  /** Issues in the backlog/todo lifecycle buckets. */
  notStarted: number;
  /** Null when there are no linked issues, never a synthetic 0% value. */
  completionRate: number | null;
  /** Sum of only the issues with an estimate_points value. */
  estimatedPoints: number;
  /** Sum of estimate_points for completed issues with an estimate. */
  completedPoints: number;
  /** Issues whose estimate_points value is unset. */
  unestimatedCount: number;
  /** Sprint capacity; null for non-sprint items and an unset capacity. */
  capacityPoints: number | null;
  /** capacityPoints - estimatedPoints, or null when capacity is unset. */
  remainingCapacityPoints: number | null;
}

type StatusBucket = "completed" | "inProgress" | "notStarted";

const STATUS_BUCKETS: Record<Status, StatusBucket> = {
  backlog: "notStarted",
  todo: "notStarted",
  in_progress: "inProgress",
  in_review: "inProgress",
  done: "completed",
  closed: "completed",
};

function planningIdOf(
  issue: IssueListItem,
  kind: PlanningKind,
): string | null | undefined {
  if (kind === "sprints") return issue.sprint_id;
  if (kind === "milestones") return issue.milestone_id;
  return issue.release_id;
}

function capacityFor(
  kind: PlanningKind,
  item: PlanningRollupItem,
): number | null {
  return kind === "sprints" ? ((item as Sprint).capacity_points ?? null) : null;
}

function emptyRollup(capacityPoints: number | null): PlanningRollup {
  return {
    total: 0,
    completed: 0,
    inProgress: 0,
    notStarted: 0,
    completionRate: null,
    estimatedPoints: 0,
    completedPoints: 0,
    unestimatedCount: 0,
    capacityPoints,
    remainingCapacityPoints: capacityPoints,
  };
}

/**
 * Derive the shared planning-list rollup in one deterministic pass.
 *
 * The map is initialized from `items`, so successful empty planning items are
 * represented explicitly. Issues linked to an id absent from the current
 * catalog are ignored because there is no row to render for them. A missing
 * estimate remains visible through `unestimatedCount`; it never contributes to
 * either points total or an inferred capacity value.
 */
export function computePlanningRollup(
  kind: PlanningKind,
  items: readonly PlanningRollupItem[],
  issues: readonly IssueListItem[],
): Map<string, PlanningRollup> {
  const rollups = new Map<string, PlanningRollup>();
  for (const item of items) {
    rollups.set(item.id, emptyRollup(capacityFor(kind, item)));
  }

  for (const issue of issues) {
    const id = planningIdOf(issue, kind);
    if (!id) continue;
    const rollup = rollups.get(id);
    if (!rollup) continue;

    rollup.total += 1;
    const bucket = STATUS_BUCKETS[issue.status];
    rollup[bucket] += 1;

    if (issue.estimate_points == null) {
      rollup.unestimatedCount += 1;
    } else {
      rollup.estimatedPoints += issue.estimate_points;
      if (bucket === "completed") {
        rollup.completedPoints += issue.estimate_points;
      }
    }
  }

  for (const rollup of rollups.values()) {
    rollup.completionRate =
      rollup.total === 0 ? null : rollup.completed / rollup.total;
    rollup.remainingCapacityPoints =
      rollup.capacityPoints === null
        ? null
        : rollup.capacityPoints - rollup.estimatedPoints;
  }

  return rollups;
}
