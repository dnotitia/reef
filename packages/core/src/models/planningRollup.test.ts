import { describe, expect, it } from "vitest";
import type { IssueListItem } from "../schemas/issues/metadata";
import type { Milestone, Sprint } from "../schemas/planning/catalog";
import { computePlanningRollup } from "./planningRollup";

function issue(partial: Partial<IssueListItem>): IssueListItem {
  return partial as IssueListItem;
}

function sprint(id: string, capacity_points: number | null = null): Sprint {
  return {
    id,
    name: id,
    status: "active",
    start_date: null,
    end_date: null,
    goal: "",
    capacity_points,
  };
}

function milestone(id: string): Milestone {
  return {
    id,
    name: id,
    status: "open",
    target_date: null,
    description: "",
  };
}

describe("computePlanningRollup", () => {
  it("maps every lifecycle status into the required buckets", () => {
    const rollup = computePlanningRollup(
      "sprints",
      [sprint("sprint-1")],
      [
        issue({ sprint_id: "sprint-1", status: "done" }),
        issue({ sprint_id: "sprint-1", status: "closed" }),
        issue({ sprint_id: "sprint-1", status: "in_progress" }),
        issue({ sprint_id: "sprint-1", status: "in_review" }),
        issue({ sprint_id: "sprint-1", status: "backlog" }),
        issue({ sprint_id: "sprint-1", status: "todo" }),
      ],
    );

    expect(rollup.get("sprint-1")).toMatchObject({
      total: 6,
      completed: 2,
      inProgress: 2,
      notStarted: 2,
      completionRate: 2 / 6,
    });
  });

  it("keeps successful empty items at zero with no completion ratio", () => {
    const rollup = computePlanningRollup(
      "milestones",
      [milestone("empty")],
      [],
    );

    expect(rollup.get("empty")).toEqual({
      total: 0,
      completed: 0,
      inProgress: 0,
      notStarted: 0,
      completionRate: null,
      estimatedPoints: 0,
      completedPoints: 0,
      unestimatedCount: 0,
      capacityPoints: null,
      remainingCapacityPoints: null,
    });
  });

  it("sums only configured estimates and preserves unestimated issues", () => {
    const rollup = computePlanningRollup(
      "sprints",
      [sprint("sprint-1")],
      [
        issue({ sprint_id: "sprint-1", status: "done", estimate_points: 5 }),
        issue({
          sprint_id: "sprint-1",
          status: "in_progress",
          estimate_points: 3,
        }),
        issue({ sprint_id: "sprint-1", status: "todo", estimate_points: null }),
        issue({ sprint_id: "sprint-1", status: "backlog" }),
      ],
    );

    expect(rollup.get("sprint-1")).toMatchObject({
      estimatedPoints: 8,
      completedPoints: 5,
      unestimatedCount: 2,
    });
  });

  it("preserves null capacity and distinguishes explicit zero capacity", () => {
    const issues = [
      issue({ sprint_id: "null-capacity", status: "todo", estimate_points: 2 }),
      issue({ sprint_id: "zero-capacity", status: "todo", estimate_points: 2 }),
    ];
    const rollup = computePlanningRollup(
      "sprints",
      [sprint("null-capacity"), sprint("zero-capacity", 0)],
      issues,
    );

    expect(rollup.get("null-capacity")).toMatchObject({
      capacityPoints: null,
      remainingCapacityPoints: null,
    });
    expect(rollup.get("zero-capacity")).toMatchObject({
      capacityPoints: 0,
      remainingCapacityPoints: -2,
    });
  });

  it("keeps catalog order and ignores links outside the loaded catalog", () => {
    const rollup = computePlanningRollup(
      "milestones",
      [milestone("first"), milestone("second")],
      [
        issue({ milestone_id: "second", status: "todo" }),
        issue({ milestone_id: "unknown", status: "done" }),
      ],
    );

    expect([...rollup.keys()]).toEqual(["first", "second"]);
    expect(rollup.get("second")?.total).toBe(1);
  });
});
