// @vitest-environment node

import type { PlanningCatalog } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  findPlanningName,
  isAssignablePlanningItem,
  itemsForKind,
  selectActiveSprint,
  upcomingMilestones,
  upcomingReleases,
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
  rollover_resumes: [],
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

  it("puts dated active sprints ahead of undated ones and uses id for an undated tie", () => {
    expect(
      selectActiveSprint([
        { ...catalog.sprints[0], id: "z-undated", start_date: null },
        { ...catalog.sprints[0], id: "a-dated", start_date: "2026-06-11" },
        { ...catalog.sprints[0], id: "b-undated", start_date: null },
      ]),
    ).toMatchObject({ id: "a-dated" });

    expect(
      selectActiveSprint([
        { ...catalog.sprints[0], id: "a-undated", start_date: null },
        { ...catalog.sprints[0], id: "b-undated", start_date: null },
      ]),
    ).toMatchObject({ id: "b-undated" });
  });
});

describe("Planning Overview selectors", () => {
  it("filters closed milestones and sorts dated items before undated items", () => {
    const milestones: PlanningCatalog["milestones"] = [
      {
        ...catalog.milestones[0],
        id: "mil-undated",
        target_date: null,
      },
      {
        ...catalog.milestones[0],
        id: "mil-late",
        target_date: "2026-07-01",
      },
      {
        ...catalog.milestones[0],
        id: "mil-closed",
        status: "closed",
        target_date: "2026-06-01",
      },
      {
        ...catalog.milestones[0],
        id: "mil-early",
        target_date: "2026-06-01",
      },
    ];
    const originalOrder = milestones.map((item) => item.id);

    expect(upcomingMilestones(milestones).map((item) => item.id)).toEqual([
      "mil-early",
      "mil-late",
      "mil-undated",
    ]);
    expect(milestones.map((item) => item.id)).toEqual(originalOrder);
  });

  it("keeps unfinished releases, orders status ties, and excludes released items", () => {
    const releases: PlanningCatalog["releases"] = [
      {
        ...catalog.releases[0],
        id: "rel-undated-planned",
        status: "planned",
        target_date: null,
      },
      {
        ...catalog.releases[0],
        id: "rel-same-planned",
        status: "planned",
        target_date: "2026-06-10",
      },
      {
        ...catalog.releases[0],
        id: "rel-same-progress",
        status: "in_progress",
        target_date: "2026-06-10",
      },
      {
        ...catalog.releases[0],
        id: "rel-released",
        status: "released",
        target_date: "2026-06-01",
      },
      {
        ...catalog.releases[0],
        id: "rel-undated-progress",
        status: "in_progress",
        target_date: null,
      },
    ];

    expect(upcomingReleases(releases).map((item) => item.id)).toEqual([
      "rel-same-progress",
      "rel-same-planned",
      "rel-undated-progress",
      "rel-undated-planned",
    ]);
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
