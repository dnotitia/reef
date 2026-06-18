// @vitest-environment node

import type { IssueListItem, Sprint } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  buildMyWork,
  classifyDue,
  compareFocus,
  filterAssignedTo,
  groupByStatus,
  selectCurrentSprint,
} from "./myWork";

const NOW = Date.parse("2026-06-18T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const base = { created_by: "me", updated_by: "me" };

const makeIssue = (
  overrides: Partial<IssueListItem> & { id: string },
): IssueListItem =>
  ({
    ...base,
    title: `Issue ${overrides.id}`,
    status: "todo",
    issue_type: "task",
    assigned_to: "me",
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    ...overrides,
  }) as IssueListItem;

const SPRINT: Sprint = {
  id: "spr-1",
  name: "Sprint 24",
  status: "active",
  start_date: "2026-06-15",
  end_date: "2026-06-26",
  goal: "",
  capacity_points: null,
};

describe("filterAssignedTo", () => {
  it("keeps exact assignees and drops substring matches", () => {
    const mine = makeIssue({ id: "A", assigned_to: "ann" });
    const other = makeIssue({ id: "B", assigned_to: "joann" }); // contains "ann"
    const cased = makeIssue({ id: "C", assigned_to: "Ann" });
    const none = makeIssue({ id: "D", assigned_to: null });
    expect(
      filterAssignedTo([mine, other, cased, none], "ann").map((i) => i.id),
    ).toEqual(["A", "C"]);
  });

  it("matches nothing for an empty login", () => {
    expect(filterAssignedTo([makeIssue({ id: "A" })], "  ")).toEqual([]);
  });
});

describe("classifyDue", () => {
  it("flags a past deadline overdue and a near one due_soon", () => {
    expect(classifyDue(iso(-DAY), "in_progress", NOW)).toBe("overdue");
    expect(classifyDue(iso(3 * DAY), "todo", NOW)).toBe("due_soon");
    expect(classifyDue(iso(30 * DAY), "todo", NOW)).toBe("none");
  });

  it("has no deadline state when resolved, undated, or unparseable", () => {
    expect(classifyDue(iso(-DAY), "done", NOW)).toBe("none");
    expect(classifyDue(null, "todo", NOW)).toBe("none");
    expect(classifyDue("not-a-date", "todo", NOW)).toBe("none");
  });
});

describe("buildMyWork", () => {
  const issues: IssueListItem[] = [
    makeIssue({
      id: "REEF-1",
      status: "in_progress",
      priority: "high",
      due_date: iso(-DAY),
    }), // overdue
    makeIssue({
      id: "REEF-2",
      status: "in_review",
      priority: "medium",
      due_date: iso(DAY),
    }), // due_soon
    makeIssue({
      id: "REEF-3",
      status: "in_progress",
      priority: "high",
      due_date: iso(2 * DAY),
    }), // due_soon
    makeIssue({ id: "REEF-4", status: "todo", priority: "high" }),
    makeIssue({ id: "REEF-5", status: "backlog", priority: "low" }),
    makeIssue({ id: "REEF-6", status: "todo", priority: "medium" }),
    makeIssue({
      id: "REEF-7",
      status: "done",
      priority: "high",
      sprint_id: "spr-1",
    }), // resolved → excluded
    makeIssue({ id: "REEF-8", status: "closed", priority: "low" }), // resolved → excluded
    makeIssue({
      id: "REEF-9",
      status: "todo",
      archived_at: "2026-05-01T00:00:00.000Z",
    }), // archived → excluded
  ];

  const { items, summary } = buildMyWork(issues, issues, {
    now: NOW,
    currentSprint: SPRINT,
  });

  it("breaks open work down by status, excluding resolved and archived (AC2)", () => {
    expect(summary.byStatus).toEqual([
      { status: "backlog", count: 1 },
      { status: "todo", count: 2 },
      { status: "in_progress", count: 2 },
      { status: "in_review", count: 1 },
    ]);
    expect(summary.open).toBe(6);
  });

  it("counts overdue / due-soon and rolls them into attention (AC3)", () => {
    expect(summary.overdue).toBe(1);
    expect(summary.dueSoon).toBe(2);
    expect(summary.attention).toBe(3);
  });

  it("counts in-progress WIP (AC4)", () => {
    expect(summary.wip).toBe(2);
  });

  it("tallies the current sprint's remaining and done (AC5)", () => {
    // REEF-7 (done) and REEF-1..3 are not all in the sprint; add coverage via
    // a sprint-scoped set below. Here only REEF-7 carries sprint_id.
    expect(summary.sprint).toEqual({
      sprintId: "spr-1",
      name: "Sprint 24",
      remaining: 0,
      done: 1,
      total: 1,
    });
  });

  it("orders the queue by urgency, then priority, then proximity (AC6)", () => {
    const order = items.map((i) => i.issue.id);
    // overdue first, then the two due_soon by nearest date, then the rest.
    expect(order.slice(0, 3)).toEqual(["REEF-1", "REEF-2", "REEF-3"]);
    // REEF-4 (todo,high) outranks REEF-6 (todo,medium) and REEF-5 (backlog,low).
    expect(order.indexOf("REEF-4")).toBeLessThan(order.indexOf("REEF-6"));
    expect(order.indexOf("REEF-6")).toBeLessThan(order.indexOf("REEF-5"));
  });

  it("marks blocked items from the relation graph", () => {
    const blocker = makeIssue({ id: "REEF-B", status: "todo" });
    const blocked = makeIssue({
      id: "REEF-C",
      status: "todo",
      depends_on: ["REEF-B"],
    });
    const graph = [blocker, blocked];
    const result = buildMyWork([blocked], graph, { now: NOW });
    expect(result.items[0]?.blocked).toBe(true);
    expect(result.items[0]?.blockerCount).toBe(1);
  });

  it("has no sprint block when the active sprint holds none of my work", () => {
    const result = buildMyWork(
      [makeIssue({ id: "REEF-X", status: "todo" })],
      [],
      {
        now: NOW,
        currentSprint: SPRINT,
      },
    );
    expect(result.summary.sprint).toBeNull();
  });
});

describe("buildMyWork sprint remaining", () => {
  it("splits my sprint work into remaining (open) and done (resolved)", () => {
    const issues: IssueListItem[] = [
      makeIssue({ id: "REEF-1", status: "in_progress", sprint_id: "spr-1" }),
      makeIssue({ id: "REEF-2", status: "todo", sprint_id: "spr-1" }),
      makeIssue({ id: "REEF-3", status: "done", sprint_id: "spr-1" }),
      makeIssue({ id: "REEF-4", status: "todo", sprint_id: "spr-other" }),
    ];
    const { summary } = buildMyWork(issues, issues, {
      now: NOW,
      currentSprint: SPRINT,
    });
    expect(summary.sprint).toMatchObject({ remaining: 2, done: 1, total: 3 });
  });
});

describe("selectCurrentSprint", () => {
  it("returns the lone active sprint", () => {
    expect(selectCurrentSprint([SPRINT])?.id).toBe("spr-1");
  });

  it("ignores planned and closed sprints", () => {
    const planned: Sprint = { ...SPRINT, id: "spr-2", status: "planned" };
    const closed: Sprint = { ...SPRINT, id: "spr-3", status: "closed" };
    expect(selectCurrentSprint([planned, closed])).toBeNull();
  });

  it("breaks an active tie by most recent start_date, then highest id", () => {
    const older: Sprint = { ...SPRINT, id: "spr-a", start_date: "2026-06-01" };
    const newer: Sprint = { ...SPRINT, id: "spr-b", start_date: "2026-06-15" };
    expect(selectCurrentSprint([older, newer])?.id).toBe("spr-b");

    const tieLow: Sprint = { ...SPRINT, id: "spr-a", start_date: "2026-06-15" };
    const tieHigh: Sprint = {
      ...SPRINT,
      id: "spr-z",
      start_date: "2026-06-15",
    };
    expect(selectCurrentSprint([tieLow, tieHigh])?.id).toBe("spr-z");
  });
});

describe("compareFocus", () => {
  it("keeps a far-future low-priority item below an undated critical one", () => {
    const dated = {
      issue: makeIssue({ id: "A", priority: "low", due_date: iso(30 * DAY) }),
      dueState: "none" as const,
      blocked: false,
      blockerCount: 0,
    };
    const undatedCritical = {
      issue: makeIssue({ id: "B", priority: "critical" }),
      dueState: "none" as const,
      blocked: false,
      blockerCount: 0,
    };
    expect(compareFocus(undatedCritical, dated)).toBeLessThan(0);
  });
});

describe("groupByStatus", () => {
  it("groups in proximity order, preserves focus order, drops empties", () => {
    const issues: IssueListItem[] = [
      makeIssue({ id: "REEF-1", status: "backlog", priority: "low" }),
      makeIssue({ id: "REEF-2", status: "in_progress", priority: "high" }),
      makeIssue({ id: "REEF-3", status: "todo", priority: "high" }),
      makeIssue({ id: "REEF-4", status: "todo", priority: "low" }),
    ];
    const { items } = buildMyWork(issues, issues, { now: NOW });
    const groups = groupByStatus(items);
    expect(groups.map((g) => g.status)).toEqual([
      "in_progress",
      "todo",
      "backlog",
    ]);
    const todo = groups.find((g) => g.status === "todo");
    expect(todo?.items.map((i) => i.issue.id)).toEqual(["REEF-3", "REEF-4"]);
  });
});
