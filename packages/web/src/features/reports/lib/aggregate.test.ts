// @vitest-environment node

import type { IssueMetadata } from "@reef/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_REPORT_FILTERS, computeAggregates } from "./aggregate";

function makeIssue(overrides: Partial<IssueMetadata>): IssueMetadata {
  return {
    id: "REEF-001",
    title: "Sample",
    status: "todo",
    created_at: "2026-04-13T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-04-13T00:00:00.000Z",
    updated_by: "alice",
    ...overrides,
  };
}

describe("computeAggregates — status", () => {
  it("returns all status buckets in canonical order, including zero counts", () => {
    const { byStatus } = computeAggregates([
      makeIssue({ id: "REEF-001", status: "todo" }),
      makeIssue({ id: "REEF-002", status: "in_progress" }),
      makeIssue({ id: "REEF-003", status: "in_progress" }),
    ]);
    // The distribution shows every status, including `backlog` (REEF-109).
    expect(byStatus).toEqual([
      { status: "backlog", count: 0 },
      { status: "todo", count: 1 },
      { status: "in_progress", count: 2 },
      { status: "in_review", count: 0 },
      { status: "done", count: 0 },
      { status: "closed", count: 0 },
    ]);
  });

  it("excludes archived issues from status counts", () => {
    const { byStatus, total } = computeAggregates([
      makeIssue({ id: "REEF-001", status: "todo" }),
      makeIssue({
        id: "REEF-002",
        status: "todo",
        archived_at: "2026-05-01T00:00:00.000Z",
      }),
    ]);
    expect(byStatus.find((b) => b.status === "todo")?.count).toBe(1);
    expect(total).toBe(1);
  });
});

describe("computeAggregates — priority", () => {
  it("returns explicit priorities in canonical order plus a 'none' bucket", () => {
    const { byPriority } = computeAggregates([
      makeIssue({ id: "REEF-001", priority: "high" }),
      makeIssue({ id: "REEF-002", priority: "high" }),
      makeIssue({ id: "REEF-003" }),
      makeIssue({ id: "REEF-004", priority: "low" }),
    ]);
    expect(byPriority).toEqual([
      { priority: "critical", count: 0 },
      { priority: "high", count: 2 },
      { priority: "medium", count: 0 },
      { priority: "low", count: 1 },
      { priority: "none", count: 1 },
    ]);
  });
});

describe("computeAggregates — assignees", () => {
  it("ranks by count desc, then name asc", () => {
    const { topAssignees } = computeAggregates([
      makeIssue({ id: "REEF-001", assigned_to: "alice" }),
      makeIssue({ id: "REEF-002", assigned_to: "alice" }),
      makeIssue({ id: "REEF-003", assigned_to: "carol" }),
      makeIssue({ id: "REEF-004", assigned_to: "bob" }),
      makeIssue({ id: "REEF-005", assigned_to: "bob" }),
    ]);
    expect(topAssignees).toEqual([
      { name: "alice", count: 2 },
      { name: "bob", count: 2 },
      { name: "carol", count: 1 },
    ]);
  });

  it("buckets missing/whitespace-only assignees under 'Unassigned'", () => {
    const { topAssignees } = computeAggregates([
      makeIssue({ id: "REEF-001" }),
      makeIssue({ id: "REEF-002", assigned_to: "   " }),
      makeIssue({ id: "REEF-003", assigned_to: "alice" }),
    ]);
    expect(topAssignees).toContainEqual({ name: "Unassigned", count: 2 });
    expect(topAssignees).toContainEqual({ name: "alice", count: 1 });
  });

  it("respects the assigneeLimit option", () => {
    const issues = Array.from({ length: 10 }, (_, i) =>
      makeIssue({
        id: `REEF-${String(i).padStart(3, "0")}`,
        assigned_to: `u${i}`,
      }),
    );
    const { topAssignees } = computeAggregates(issues, { assigneeLimit: 3 });
    expect(topAssignees).toHaveLength(3);
  });
});

describe("computeAggregates — labels", () => {
  it("counts each label occurrence — totals may exceed issue count", () => {
    const { topLabels } = computeAggregates([
      makeIssue({ id: "REEF-001", labels: ["bug", "frontend"] }),
      makeIssue({ id: "REEF-002", labels: ["bug"] }),
      makeIssue({ id: "REEF-003", labels: ["frontend", "design"] }),
    ]);
    expect(topLabels).toContainEqual({ name: "bug", count: 2 });
    expect(topLabels).toContainEqual({ name: "frontend", count: 2 });
    expect(topLabels).toContainEqual({ name: "design", count: 1 });
  });

  it("skips empty / whitespace-only labels", () => {
    const { topLabels } = computeAggregates([
      makeIssue({ id: "REEF-001", labels: ["", "   ", "bug"] }),
    ]);
    expect(topLabels).toEqual([{ name: "bug", count: 1 }]);
  });

  it("excludes labels from archived issues", () => {
    const { topLabels } = computeAggregates([
      makeIssue({ id: "REEF-001", labels: ["bug"] }),
      makeIssue({
        id: "REEF-002",
        labels: ["bug"],
        archived_at: "2026-05-01T00:00:00.000Z",
      }),
    ]);
    expect(topLabels).toEqual([{ name: "bug", count: 1 }]);
  });
});

const NOW = Date.parse("2026-05-26T00:00:00.000Z");
const DAY = 86_400_000;
const iso = (msFromNow: number) => new Date(NOW + msFromNow).toISOString();

describe("computeAggregates — kpis", () => {
  it("folds in_progress+in_review and done+closed, scoped to active", () => {
    const { kpis } = computeAggregates(
      [
        makeIssue({ id: "REEF-001", status: "in_progress" }),
        makeIssue({ id: "REEF-002", status: "in_review" }),
        makeIssue({ id: "REEF-003", status: "done" }),
        makeIssue({ id: "REEF-004", status: "closed" }),
        makeIssue({ id: "REEF-005", status: "todo" }),
        makeIssue({
          id: "REEF-006",
          status: "todo",
          archived_at: iso(0),
        }),
      ],
      { now: NOW },
    );
    expect(kpis.active).toBe(5);
    expect(kpis.inProgress).toBe(2);
    expect(kpis.done).toBe(2);
  });

  it("counts overdue / blocked / unassigned only for open work", () => {
    const { kpis } = computeAggregates(
      [
        // overdue + unassigned + blocked, open
        makeIssue({
          id: "REEF-001",
          status: "todo",
          due_date: iso(-2 * DAY),
          depends_on: ["REEF-099"],
        }),
        // assigned, future due — not overdue/unassigned
        makeIssue({
          id: "REEF-002",
          status: "in_progress",
          assigned_to: "alice",
          due_date: iso(3 * DAY),
        }),
        // done issue with past due — excluded from health
        makeIssue({
          id: "REEF-003",
          status: "done",
          due_date: iso(-5 * DAY),
        }),
      ],
      { now: NOW },
    );
    expect(kpis.overdue).toBe(1);
    expect(kpis.blocked).toBe(1);
    expect(kpis.unassigned).toBe(1);
  });
});

describe("computeAggregates — throughput", () => {
  it("buckets created and closed events into rolling weeks", () => {
    const { throughput } = computeAggregates(
      [
        makeIssue({ id: "REEF-001", created_at: iso(-3 * DAY) }), // this week
        makeIssue({ id: "REEF-002", created_at: iso(-10 * DAY) }), // prior week
        makeIssue({
          id: "REEF-003",
          created_at: iso(-30 * DAY),
          status: "closed",
          closed_at: iso(-2 * DAY), // closed this week
        }),
      ],
      { now: NOW, throughputWeeks: 12 },
    );
    expect(throughput).toHaveLength(12);
    const last = throughput[throughput.length - 1];
    expect(last.created).toBe(1); // REEF-001
    expect(last.closed).toBe(1); // REEF-003
    expect(throughput[throughput.length - 2].created).toBe(1); // REEF-002
  });

  it("falls back to last_status_change for closed issues without closed_at", () => {
    const { throughput } = computeAggregates(
      [
        makeIssue({
          id: "REEF-001",
          created_at: iso(-40 * DAY),
          status: "done",
          last_status_change: iso(-1 * DAY),
        }),
      ],
      { now: NOW, throughputWeeks: 12 },
    );
    expect(throughput[throughput.length - 1].closed).toBe(1);
  });

  it("uses the selected period for created / closed / net throughput windows", () => {
    const { netThroughput } = computeAggregates(
      [
        makeIssue({ id: "REEF-001", created_at: iso(-3 * DAY) }),
        makeIssue({ id: "REEF-002", created_at: iso(-10 * DAY) }),
        makeIssue({
          id: "REEF-003",
          created_at: iso(-30 * DAY),
          status: "closed",
          closed_at: iso(-2 * DAY),
        }),
      ],
      {
        now: NOW,
        filters: { ...DEFAULT_REPORT_FILTERS, period: "4w" },
      },
    );

    expect(netThroughput).toHaveLength(4);
    expect(netThroughput.at(-1)).toMatchObject({
      created: 1,
      closed: 1,
      net: 0,
    });
    expect(netThroughput.at(-2)).toMatchObject({ created: 1, net: 1 });
  });
});

describe("computeAggregates — dueHealth & aging", () => {
  it("partitions open work by due window", () => {
    const { dueHealth } = computeAggregates(
      [
        makeIssue({ id: "REEF-001", status: "todo", due_date: iso(-DAY) }),
        makeIssue({ id: "REEF-002", status: "todo", due_date: iso(2 * DAY) }),
        makeIssue({ id: "REEF-003", status: "todo", due_date: iso(30 * DAY) }),
        makeIssue({ id: "REEF-004", status: "todo" }), // no due date
      ],
      { now: NOW },
    );
    expect(dueHealth).toEqual({
      overdue: 1,
      dueThisWeek: 1,
      upcoming: 1,
      noDueDate: 1,
    });
  });

  it("buckets open work by staleness of updated_at", () => {
    const { aging } = computeAggregates(
      [
        makeIssue({
          id: "REEF-001",
          status: "todo",
          updated_at: iso(-2 * DAY),
        }),
        makeIssue({
          id: "REEF-002",
          status: "todo",
          updated_at: iso(-10 * DAY),
        }),
        makeIssue({
          id: "REEF-003",
          status: "todo",
          updated_at: iso(-20 * DAY),
        }),
        makeIssue({
          id: "REEF-004",
          status: "todo",
          updated_at: iso(-40 * DAY),
        }),
        // done issue ignored
        makeIssue({
          id: "REEF-005",
          status: "done",
          updated_at: iso(-40 * DAY),
        }),
      ],
      { now: NOW },
    );
    expect(aging).toEqual({ fresh: 1, recent: 1, stale: 1, stalled: 1 });
  });
});

describe("computeAggregates — type & severity", () => {
  it("returns only present types/severities, dropping zero buckets", () => {
    const { byType, bySeverity } = computeAggregates([
      makeIssue({ id: "REEF-001", issue_type: "bug", severity: "blocker" }),
      makeIssue({ id: "REEF-002", issue_type: "bug" }),
      makeIssue({ id: "REEF-003", issue_type: "story" }),
    ]);
    expect(byType).toEqual([
      { type: "story", count: 1 },
      { type: "bug", count: 2 },
    ]);
    expect(bySeverity).toEqual([{ severity: "blocker", count: 1 }]);
  });

  it("buckets a missing issue_type under 'task' (mirrors filterIssues)", () => {
    const { byType, total } = computeAggregates([
      makeIssue({ id: "REEF-001" }), // no issue_type
      makeIssue({ id: "REEF-002", issue_type: "task" }),
      makeIssue({ id: "REEF-003", issue_type: "bug" }),
    ]);
    expect(byType).toContainEqual({ type: "task", count: 2 });
    // Donut total stays consistent with the active-issue count.
    expect(byType.reduce((sum, b) => sum + b.count, 0)).toBe(total);
  });
});

describe("computeAggregates — report filters", () => {
  it("supports active / all / completed scopes", () => {
    const issues = [
      makeIssue({ id: "REEF-001", status: "todo" }),
      makeIssue({ id: "REEF-002", status: "done" }),
      makeIssue({
        id: "REEF-003",
        status: "todo",
        archived_at: iso(0),
      }),
    ];

    expect(
      computeAggregates(issues, {
        filters: { ...DEFAULT_REPORT_FILTERS, scope: "active" },
      }).filteredTotal,
    ).toBe(2);
    expect(
      computeAggregates(issues, {
        filters: { ...DEFAULT_REPORT_FILTERS, scope: "all" },
      }).filteredTotal,
    ).toBe(3);
    expect(
      computeAggregates(issues, {
        filters: { ...DEFAULT_REPORT_FILTERS, scope: "completed" },
      }).filteredTotal,
    ).toBe(1);
  });

  it("combines assignee, label, and planning filters", () => {
    const { filteredTotal, topAssignees, topLabels } = computeAggregates(
      [
        makeIssue({
          id: "REEF-001",
          assigned_to: "alice",
          labels: ["ui", "risk"],
          sprint_id: "spr-1",
          milestone_id: "mil-1",
          release_id: "rel-1",
        }),
        makeIssue({
          id: "REEF-002",
          assigned_to: "alice",
          labels: ["ui"],
          sprint_id: "spr-2",
          milestone_id: "mil-1",
          release_id: "rel-1",
        }),
        makeIssue({
          id: "REEF-003",
          assigned_to: "bob",
          labels: ["risk"],
          sprint_id: "spr-1",
          milestone_id: "mil-1",
          release_id: "rel-1",
        }),
      ],
      {
        filters: {
          ...DEFAULT_REPORT_FILTERS,
          assignee: "alice",
          label: "risk",
          sprint_id: "spr-1",
          milestone_id: "mil-1",
          release_id: "rel-1",
        },
      },
    );

    expect(filteredTotal).toBe(1);
    expect(topAssignees).toEqual([{ name: "alice", count: 1 }]);
    expect(topLabels).toEqual([
      { name: "risk", count: 1 },
      { name: "ui", count: 1 },
    ]);
  });
});

describe("computeAggregates — risk", () => {
  it("builds a priority by aging risk matrix for open work", () => {
    const { riskMatrix } = computeAggregates(
      [
        makeIssue({
          id: "REEF-001",
          priority: "critical",
          updated_at: iso(-40 * DAY),
        }),
        makeIssue({
          id: "REEF-002",
          priority: "high",
          updated_at: iso(-20 * DAY),
        }),
        makeIssue({
          id: "REEF-003",
          priority: "low",
          updated_at: iso(-3 * DAY),
        }),
      ],
      { now: NOW },
    );

    expect(riskMatrix).toContainEqual({
      priority: "critical",
      aging: "stalled",
      count: 1,
    });
    expect(riskMatrix).toContainEqual({
      priority: "high",
      aging: "stale",
      count: 1,
    });
    expect(riskMatrix).toContainEqual({
      priority: "low",
      aging: "fresh",
      count: 1,
    });
  });

  it("counts at-risk work from overdue, blocked, stale, and critical signals once per issue", () => {
    const { riskSummary } = computeAggregates(
      [
        makeIssue({
          id: "REEF-001",
          due_date: iso(-DAY),
          depends_on: ["REEF-099"],
          updated_at: iso(-40 * DAY),
        }),
        makeIssue({
          id: "REEF-002",
          priority: "critical",
          assigned_to: "alice",
          updated_at: iso(-2 * DAY),
        }),
        makeIssue({
          id: "REEF-003",
          severity: "critical",
          assigned_to: "bob",
          updated_at: iso(-2 * DAY),
        }),
        makeIssue({
          id: "REEF-004",
          assigned_to: "carol",
          updated_at: iso(-2 * DAY),
        }),
      ],
      { now: NOW },
    );

    expect(riskSummary).toMatchObject({
      atRisk: 3,
      overdue: 1,
      blocked: 1,
      stale: 1,
      critical: 2,
    });
  });

  it("counts blocked risk only when a dependency is unresolved", () => {
    const { kpis, riskSummary } = computeAggregates(
      [
        makeIssue({
          id: "REEF-001",
          depends_on: ["REEF-002"],
          updated_at: iso(-2 * DAY),
        }),
        makeIssue({
          id: "REEF-002",
          status: "done",
          updated_at: iso(-2 * DAY),
        }),
        makeIssue({
          id: "REEF-003",
          depends_on: ["REEF-004"],
          updated_at: iso(-2 * DAY),
        }),
        makeIssue({
          id: "REEF-004",
          status: "in_progress",
          updated_at: iso(-2 * DAY),
        }),
        makeIssue({
          id: "REEF-005",
          depends_on: ["REEF-999"],
          updated_at: iso(-2 * DAY),
        }),
        makeIssue({
          id: "REEF-006",
          status: "done",
          depends_on: ["REEF-004"],
          updated_at: iso(-2 * DAY),
        }),
      ],
      { now: NOW },
    );

    expect(kpis.blocked).toBe(2);
    expect(riskSummary).toMatchObject({
      atRisk: 2,
      blocked: 2,
      overdue: 0,
      stale: 0,
      critical: 0,
    });
  });
});
