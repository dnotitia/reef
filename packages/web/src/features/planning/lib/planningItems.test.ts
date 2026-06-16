// @vitest-environment node

import type { IssueListItem, PlanningCatalog } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  countIssuesByPlanningId,
  findPlanningName,
  isAssignablePlanningItem,
  itemsForKind,
} from "./planningItems";

function issue(partial: Partial<IssueListItem>): IssueListItem {
  return partial as IssueListItem;
}

const catalog: PlanningCatalog = {
  sprints: [
    {
      id: "spr-1",
      name: "Sprint One",
      status: "active",
      start_date: null,
      end_date: null,
      goal: "",
      capacity_points: null,
    },
  ],
  milestones: [
    {
      id: "mil-1",
      name: "Beta",
      status: "open",
      target_date: null,
      description: "",
    },
  ],
  releases: [
    {
      id: "rel-1",
      name: "v1.0",
      status: "planned",
      target_date: null,
      released_at: null,
      notes: "",
    },
  ],
};

describe("countIssuesByPlanningId", () => {
  const issues = [
    issue({ sprint_id: "spr-1", milestone_id: "mil-1", release_id: "rel-1" }),
    issue({ sprint_id: "spr-1", milestone_id: null, release_id: "rel-1" }),
    issue({ sprint_id: "spr-2", milestone_id: "mil-1", release_id: null }),
    issue({
      sprint_id: undefined,
      milestone_id: undefined,
      release_id: undefined,
    }),
  ];

  it("counts sprints in one pass and skips unset ids", () => {
    const counts = countIssuesByPlanningId(issues, "sprints");
    expect(counts.get("spr-1")).toBe(2);
    expect(counts.get("spr-2")).toBe(1);
    expect(counts.size).toBe(2);
  });

  it("counts milestones", () => {
    const counts = countIssuesByPlanningId(issues, "milestones");
    expect(counts.get("mil-1")).toBe(2);
    expect(counts.has("mil-2")).toBe(false);
  });

  it("counts releases", () => {
    const counts = countIssuesByPlanningId(issues, "releases");
    expect(counts.get("rel-1")).toBe(2);
    expect(counts.size).toBe(1);
  });

  it("returns an empty map when there are no issues", () => {
    expect(countIssuesByPlanningId([], "sprints").size).toBe(0);
  });
});

describe("itemsForKind", () => {
  it("returns the array for each kind, empty when no catalog", () => {
    expect(itemsForKind(catalog, "sprints")).toHaveLength(1);
    expect(itemsForKind(catalog, "milestones")[0]?.name).toBe("Beta");
    expect(itemsForKind(undefined, "releases")).toEqual([]);
  });
});

describe("findPlanningName", () => {
  it("resolves an id to its name, or null when unknown/unset", () => {
    expect(findPlanningName(catalog, "sprints", "spr-1")).toBe("Sprint One");
    expect(findPlanningName(catalog, "sprints", "spr-x")).toBeNull();
    expect(findPlanningName(catalog, "sprints", null)).toBeNull();
  });
});

describe("isAssignablePlanningItem", () => {
  it("treats active/planned sprints, open milestones, and non-released releases as assignable", () => {
    expect(isAssignablePlanningItem("sprints", catalog.sprints[0])).toBe(true);
    expect(isAssignablePlanningItem("milestones", catalog.milestones[0])).toBe(
      true,
    );
    expect(isAssignablePlanningItem("releases", catalog.releases[0])).toBe(
      true,
    );
    expect(
      isAssignablePlanningItem("milestones", {
        ...catalog.milestones[0],
        status: "closed",
      }),
    ).toBe(false);
  });
});
