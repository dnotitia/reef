// @vitest-environment node

import type {
  IssueMetadata,
  Milestone,
  PlanningCatalog,
  Release,
  Sprint,
} from "@reef/core";
import { describe, expect, it } from "vitest";
import { classifyHealth, computeHealthRollup } from "./healthRollup";

const NOW = Date.parse("2026-06-17T12:00:00.000Z");

function makeIssue(overrides: Partial<IssueMetadata>): IssueMetadata {
  return {
    id: "REEF-001",
    title: "Sample",
    status: "todo",
    created_at: "2026-06-05T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-06-15T00:00:00.000Z",
    updated_by: "alice",
    ...overrides,
  };
}

function milestone(overrides: Partial<Milestone> & { id: string }): Milestone {
  return {
    name: overrides.id,
    status: "open",
    target_date: null,
    description: "",
    ...overrides,
  };
}

function sprint(overrides: Partial<Sprint> & { id: string }): Sprint {
  return {
    name: overrides.id,
    status: "active",
    start_date: null,
    end_date: null,
    goal: "",
    capacity_points: null,
    ...overrides,
  };
}

function release(overrides: Partial<Release> & { id: string }): Release {
  return {
    name: overrides.id,
    status: "planned",
    target_date: null,
    released_at: null,
    notes: "",
    ...overrides,
  };
}

function catalog(parts: Partial<PlanningCatalog>): PlanningCatalog {
  return { sprints: [], milestones: [], releases: [], ...parts };
}

describe("classifyHealth — thresholds (REEF-191 AC3)", () => {
  const base = {
    overdue: 0,
    blocked: 0,
    net: 0,
    completion: 1,
    elapsedFraction: 0.5,
    targetPassed: false,
  };

  it("is on track when nothing is wrong", () => {
    expect(classifyHealth(base).level).toBe("on_track");
  });

  it("is off track when the target date has passed with work open", () => {
    const v = classifyHealth({ ...base, targetPassed: true, completion: 0.4 });
    expect(v.level).toBe("off_track");
    expect(v.reason).toMatch(/past target/);
  });

  it("is off track with overdue work past the mid-point", () => {
    expect(
      classifyHealth({ ...base, overdue: 3, elapsedFraction: 0.6 }).level,
    ).toBe("off_track");
  });

  it("is off track when far behind pace (deficit >= 25%)", () => {
    expect(
      classifyHealth({ ...base, completion: 0.2, elapsedFraction: 0.5 }).level,
    ).toBe("off_track");
  });

  it("is at risk with early overdue work (before the mid-point)", () => {
    const v = classifyHealth({ ...base, overdue: 1, elapsedFraction: 0.2 });
    expect(v.level).toBe("at_risk");
    expect(v.reason).toBe("1 overdue");
  });

  it("is at risk when blocked", () => {
    expect(classifyHealth({ ...base, blocked: 2 }).level).toBe("at_risk");
  });

  it("is at risk when modestly behind pace (deficit >= 10%)", () => {
    expect(
      classifyHealth({ ...base, completion: 0.35, elapsedFraction: 0.5 }).level,
    ).toBe("at_risk");
  });

  it("is at risk when the backlog is growing (net > 0)", () => {
    const v = classifyHealth({ ...base, net: 4 });
    expect(v.level).toBe("at_risk");
    expect(v.reason).toBe("backlog +4");
  });

  it("ignores pace when there is no time anchor", () => {
    expect(
      classifyHealth({ ...base, completion: 0, elapsedFraction: null }).level,
    ).toBe("on_track");
  });
});

describe("computeHealthRollup — grouping & sort", () => {
  it("returns one row per catalog item, worst-first", () => {
    const rows = computeHealthRollup(
      [
        // M1: overdue open work past the mid-point of a near target → off track
        makeIssue({
          id: "A",
          milestone_id: "M1",
          status: "todo",
          due_date: "2026-06-10T00:00:00.000Z",
          created_at: "2026-06-01T00:00:00.000Z",
        }),
        // M2: all resolved, nothing overdue, balanced flow → on track
        makeIssue({
          id: "B",
          milestone_id: "M2",
          status: "done",
          created_at: "2026-06-05T00:00:00.000Z",
        }),
        makeIssue({
          id: "C",
          milestone_id: "M2",
          status: "done",
          created_at: "2026-06-06T00:00:00.000Z",
        }),
      ],
      {
        dimension: "milestone",
        now: NOW,
        catalog: catalog({
          milestones: [
            milestone({ id: "M1", target_date: "2026-06-30T00:00:00.000Z" }),
            milestone({ id: "M2", target_date: "2026-12-31T00:00:00.000Z" }),
          ],
        }),
      },
    );
    expect(rows.map((r) => r.id)).toEqual(["M1", "M2"]);
    expect(rows[0].verdict?.level).toBe("off_track");
    expect(rows[1].verdict?.level).toBe("on_track");
    expect(rows[1].completion).toBe(1);
  });

  it("gives an empty item no verdict and sorts it last", () => {
    const rows = computeHealthRollup(
      [makeIssue({ id: "A", milestone_id: "M1", status: "todo" })],
      {
        dimension: "milestone",
        now: NOW,
        catalog: catalog({
          milestones: [milestone({ id: "M1" }), milestone({ id: "M_EMPTY" })],
        }),
      },
    );
    const empty = rows.find((r) => r.id === "M_EMPTY");
    expect(empty?.verdict).toBeNull();
    expect(empty?.total).toBe(0);
    expect(rows.at(-1)?.id).toBe("M_EMPTY");
  });

  it("treats a shipped (released) item as on track regardless of signals", () => {
    const rows = computeHealthRollup(
      [
        makeIssue({
          id: "A",
          release_id: "R1",
          status: "todo",
          due_date: "2026-01-01T00:00:00.000Z", // overdue
        }),
      ],
      {
        dimension: "release",
        now: NOW,
        catalog: catalog({
          releases: [release({ id: "R1", status: "released" })],
        }),
      },
    );
    expect(rows[0].shipped).toBe(true);
    expect(rows[0].verdict).toEqual({ level: "on_track", reason: "shipped" });
  });

  it("ignores its own axis filter but applies the other facets", () => {
    const rows = computeHealthRollup(
      [
        makeIssue({ id: "A", milestone_id: "M1", assigned_to: "alice" }),
        makeIssue({ id: "B", milestone_id: "M2", assigned_to: "bob" }),
      ],
      {
        dimension: "milestone",
        now: NOW,
        // milestone_id filter is ignored (rollup shows all milestones);
        // assignee filter still applies.
        filters: {
          period: "12w",
          scope: "active",
          measure: "count",
          milestone_id: "M2",
          assignee: "alice",
        },
        catalog: catalog({
          milestones: [milestone({ id: "M1" }), milestone({ id: "M2" })],
        }),
      },
    );
    expect(rows.map((r) => r.id).sort()).toEqual(["M1", "M2"]);
    expect(rows.find((r) => r.id === "M1")?.total).toBe(1); // alice's issue
    expect(rows.find((r) => r.id === "M2")?.total).toBe(0); // bob filtered out
  });
});

describe("computeHealthRollup — sprint capacity burn", () => {
  // Low issue-count completion (1/3) but high point burn (9/10); the verdict
  // should flip on whether the sprint declared capacity.
  const issues = [
    makeIssue({
      id: "DONE",
      sprint_id: "S1",
      status: "done",
      estimate_points: 9,
      created_at: "2026-06-05T00:00:00.000Z",
      updated_at: "2026-06-15T00:00:00.000Z",
    }),
    // Open work created before the throughput window → no net contribution.
    makeIssue({
      id: "OPEN1",
      sprint_id: "S1",
      status: "todo",
      estimate_points: 1,
      created_at: "2026-02-01T00:00:00.000Z",
    }),
    makeIssue({
      id: "OPEN2",
      sprint_id: "S1",
      status: "todo",
      estimate_points: 1,
      created_at: "2026-02-01T00:00:00.000Z",
    }),
  ];

  it("uses capacity burn when capacity_points is set", () => {
    const rows = computeHealthRollup(issues, {
      dimension: "sprint",
      now: NOW,
      catalog: catalog({
        sprints: [
          sprint({
            id: "S1",
            start_date: "2026-06-01T00:00:00.000Z",
            end_date: "2026-06-20T00:00:00.000Z",
            capacity_points: 10,
          }),
        ],
      }),
    });
    expect(rows[0].completion).toBeCloseTo(1 / 3); // bar still shows issue count
    expect(rows[0].verdict?.level).toBe("on_track"); // burn 0.9 keeps pace
  });

  it("falls back to issue completion when capacity_points is null", () => {
    const rows = computeHealthRollup(issues, {
      dimension: "sprint",
      now: NOW,
      catalog: catalog({
        sprints: [
          sprint({
            id: "S1",
            start_date: "2026-06-01T00:00:00.000Z",
            end_date: "2026-06-20T00:00:00.000Z",
            capacity_points: null,
          }),
        ],
      }),
    });
    // elapsed ~0.84, completion 0.33 → pace deficit ~0.51 → off track.
    expect(rows[0].verdict?.level).toBe("off_track");
  });
});

describe("computeHealthRollup — parent axis (REEF-187)", () => {
  it("rolls up children by parent, naming each row from the parent title", () => {
    const rows = computeHealthRollup(
      [
        // Parent epic with a human title and two children (1 done, 1 open).
        makeIssue({ id: "E1", title: "Reports epic", status: "in_progress" }),
        makeIssue({ id: "c1", parent_id: "E1", status: "done" }),
        makeIssue({ id: "c2", parent_id: "E1", status: "todo" }),
        // AC2: a childless, top-level issue is not a rollup row.
        makeIssue({ id: "solo", status: "todo" }),
      ],
      { dimension: "parent", now: NOW, catalog: catalog({}) },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("E1");
    expect(rows[0].name).toBe("Reports epic"); // AC4: parent title, not its id
    expect(rows[0].total).toBe(2);
    expect(rows[0].resolved).toBe(1);
    expect(rows[0].completion).toBe(0.5); // AC3: count-based completion
  });

  it("falls back to the parent id when the parent issue is absent", () => {
    const rows = computeHealthRollup(
      [makeIssue({ id: "c1", parent_id: "GHOST", status: "todo" })],
      { dimension: "parent", now: NOW, catalog: catalog({}) },
    );
    expect(rows[0].id).toBe("GHOST");
    expect(rows[0].name).toBe("GHOST");
  });

  it("treats a resolved parent as shipped", () => {
    const rows = computeHealthRollup(
      [
        makeIssue({ id: "E1", title: "Done epic", status: "done" }),
        makeIssue({ id: "c1", parent_id: "E1", status: "done" }),
      ],
      { dimension: "parent", now: NOW, catalog: catalog({}) },
    );
    expect(rows[0].shipped).toBe(true);
    expect(rows[0].verdict).toEqual({ level: "on_track", reason: "shipped" });
  });

  it("ranks parents worst-first and anchors the deadline on the parent due_date", () => {
    const rows = computeHealthRollup(
      [
        // Healthy: the child is done → on track.
        makeIssue({ id: "E_OK", title: "Healthy", status: "in_progress" }),
        makeIssue({ id: "ok1", parent_id: "E_OK", status: "done" }),
        // Off track: parent due date already passed with an open child.
        makeIssue({
          id: "E_LATE",
          title: "Late",
          status: "in_progress",
          due_date: "2026-01-01T00:00:00.000Z",
        }),
        makeIssue({ id: "l1", parent_id: "E_LATE", status: "todo" }),
      ],
      { dimension: "parent", now: NOW, catalog: catalog({}) },
    );
    expect(rows.map((r) => r.id)).toEqual(["E_LATE", "E_OK"]);
    expect(rows[0].targetDate).toBe("2026-01-01T00:00:00.000Z");
    expect(rows[0].verdict?.level).toBe("off_track");
    expect(rows[1].verdict?.level).toBe("on_track");
  });
});
