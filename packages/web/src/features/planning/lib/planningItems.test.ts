// @vitest-environment node

import type { PlanningCatalog } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  findPlanningName,
  isAssignablePlanningItem,
  itemsForKind,
  selectActiveSprint,
} from "./planningItems";

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

describe("selectActiveSprint", () => {
  it("chooses the latest active start date, then the highest id", () => {
    expect(
      selectActiveSprint([
        {
          ...catalog.sprints[0],
          id: "spr-1",
          start_date: "2026-06-10",
        },
        {
          ...catalog.sprints[0],
          id: "spr-2",
          start_date: "2026-06-11",
        },
        {
          ...catalog.sprints[0],
          id: "spr-3",
          start_date: "2026-06-11",
          status: "planned",
        },
      ]),
    ).toMatchObject({ id: "spr-2" });
  });

  it("returns null when no sprint is active", () => {
    expect(
      selectActiveSprint([{ ...catalog.sprints[0], status: "planned" }]),
    ).toBeNull();
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
