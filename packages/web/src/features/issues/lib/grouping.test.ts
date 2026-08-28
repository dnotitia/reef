import type { IssueListItem, IssueRelation } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  createIssueGroupDescriptor,
  groupIssues,
  type IssueGroupBucket,
} from "./grouping";

const labels = {
  none: "None",
  status: {
    backlog: "Backlog",
    todo: "Todo",
    in_progress: "In progress",
    in_review: "In review",
    done: "Done",
    closed: "Closed",
  },
  priority: {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    low: "Low",
  },
  epic: {
    none: "No epic",
    unavailableParent: "Unavailable parent",
  },
};

function issue(
  id: string,
  overrides: Partial<IssueListItem> = {},
): IssueListItem {
  return {
    id,
    title: id,
    status: "todo",
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: "tester",
    updated_at: "2026-01-01T00:00:00.000Z",
    updated_by: "tester",
    ...overrides,
  };
}

function bucket(
  descriptor: ReturnType<typeof createIssueGroupDescriptor>,
  value: string | null,
): IssueGroupBucket {
  const result = descriptor.bucketsForIssues([
    issue(`issue-${value ?? "none"}`, {
      assigned_to: value,
    }),
  ]);
  return (
    result.find((entry) => entry.bucket.value === value)?.bucket ?? {
      groupBy: descriptor.groupBy,
      id: "missing",
      label: "missing",
      value: null,
      order: Number.POSITIVE_INFINITY,
      patchField: null,
      patchValue: null,
      multiBucket: false,
      droppable: false,
    }
  );
}

describe("issue grouping descriptor", () => {
  it("uses canonical status and priority order, with None last", () => {
    const status = createIssueGroupDescriptor("status", { labels });
    expect(
      status.bucketsForIssues([]).map(({ bucket }) => bucket.value),
    ).toEqual(["todo", "in_progress", "in_review", "done", "closed"]);

    const priority = createIssueGroupDescriptor("priority", { labels });
    expect(
      priority
        .bucketsForIssues([
          issue("low", { priority: "low" }),
          issue("none", { priority: null }),
          issue("critical", { priority: "critical" }),
        ])
        .map(({ bucket }) => bucket.value),
    ).toEqual(["critical", "high", "medium", "low", null]);
  });

  it("sorts assignees and sprint labels by display name while keeping unknown ids stable", () => {
    const assignee = createIssueGroupDescriptor("assignee", {
      labels,
      assigneeNames: { bob: "Alice Example", alice: "Zoe Example" },
    });
    expect(
      assignee
        .bucketsForIssues([
          issue("z", { assigned_to: "alice" }),
          issue("a", { assigned_to: "bob" }),
          issue("none", { assigned_to: null }),
        ])
        .map(({ bucket }) => [bucket.label, bucket.value]),
    ).toEqual([
      ["Alice Example", "bob"],
      ["Zoe Example", "alice"],
      ["None", null],
    ]);

    const descriptor = createIssueGroupDescriptor("sprint", {
      labels,
      sprintNames: { sprint2: "Sprint 2", sprint1: "Sprint 1" },
    });

    expect(
      descriptor
        .bucketsForIssues([
          issue("unknown", { sprint_id: "missing-sprint" }),
          issue("s2", { sprint_id: "sprint2" }),
          issue("none", { sprint_id: null }),
          issue("s1", { sprint_id: "sprint1" }),
        ])
        .map(({ bucket }) => [bucket.label, bucket.value]),
    ).toEqual([
      ["missing-sprint", "missing-sprint"],
      ["Sprint 1", "sprint1"],
      ["Sprint 2", "sprint2"],
      ["None", null],
    ]);
  });

  it("renders each unique label occurrence, keeps source order inside buckets, and exposes patch metadata", () => {
    const descriptor = createIssueGroupDescriptor("label", { labels });
    const grouped = descriptor.bucketsForIssues([
      issue("first", { labels: ["Zebra", "alpha", "alpha"] }),
      issue("second", { labels: ["beta", "Zebra"] }),
      issue("third", { labels: [] }),
    ]);

    expect(grouped.map(({ bucket }) => bucket.label)).toEqual([
      "alpha",
      "beta",
      "Zebra",
      "None",
    ]);
    expect(grouped.map(({ issues }) => issues.map(({ id }) => id))).toEqual([
      ["first"],
      ["second"],
      ["first", "second"],
      ["third"],
    ]);
    expect(grouped[0]?.bucket).toMatchObject({
      patchField: "labels",
      patchValue: "alpha",
      multiBucket: true,
      droppable: false,
    });
    expect(
      groupIssues(
        [issue("first", { labels: ["alpha"] })],
        descriptor,
      )[0]?.issues.map(({ id }) => id),
    ).toEqual(["first"]);
  });

  it("does not invent a mutation for a same-value or None bucket", () => {
    const descriptor = createIssueGroupDescriptor("assignee", { labels });
    expect(bucket(descriptor, null)).toMatchObject({
      patchField: "assigned_to",
      patchValue: null,
      droppable: true,
    });
  });

  it("projects direct children into ranked Epic groups and keeps root headers unique", () => {
    const catalog: IssueRelation[] = [
      {
        id: "REEF-200",
        title: "Zeta Epic",
        status: "in_progress",
        issue_type: "epic",
        parent_id: null,
        rank: 20,
        depends_on: [],
      },
      {
        id: "REEF-100",
        title: "Alpha Epic",
        status: "done",
        issue_type: "epic",
        parent_id: null,
        rank: 10,
        depends_on: [],
      },
      {
        id: "REEF-300",
        title: "Regular parent",
        status: "todo",
        issue_type: "story",
        parent_id: null,
        rank: 1,
        depends_on: [],
      },
      {
        id: "REEF-400",
        title: "Nested Epic",
        status: "todo",
        issue_type: "epic",
        parent_id: "REEF-300",
        rank: 2,
        depends_on: [],
      },
    ];
    const descriptor = createIssueGroupDescriptor("epic", {
      labels,
      hierarchyCatalog: catalog,
    });
    const groups = descriptor.bucketsForIssues([
      issue("child-zeta", {
        parent_id: "REEF-200",
        status: "done",
      }),
      issue("child-alpha", {
        parent_id: "REEF-100",
        status: "closed",
      }),
      issue("child-alpha-open", {
        parent_id: "REEF-100",
        status: "todo",
      }),
      issue("REEF-100", {
        issue_type: "epic",
        title: "Alpha Epic",
        status: "done",
      }),
      issue("independent"),
      issue("missing-parent", { parent_id: "REEF-999" }),
      issue("non-epic-parent", { parent_id: "REEF-300" }),
      issue("deeper-parent", { parent_id: "REEF-400" }),
    ]);

    expect(groups.map(({ bucket }) => bucket.id)).toEqual([
      "epic:REEF-100",
      "epic:REEF-200",
      "epic:none",
      "epic:unavailable-parent",
    ]);
    expect(groups[0]).toMatchObject({
      bucket: {
        epic: { id: "REEF-100", title: "Alpha Epic", status: "done" },
        progress: { done: 1, total: 2 },
        droppable: false,
      },
      issues: [{ id: "child-alpha" }, { id: "child-alpha-open" }],
    });
    expect(groups[1]?.issues.map(({ id }) => id)).toEqual(["child-zeta"]);
    expect(groups[2]?.issues.map(({ id }) => id)).toEqual([
      "independent",
      "non-epic-parent",
      "deeper-parent",
    ]);
    expect(groups[3]?.issues.map(({ id }) => id)).toEqual(["missing-parent"]);
    expect(
      groups
        .flatMap(({ issues }) => issues)
        .filter(({ id }) => id === "REEF-100"),
    ).toHaveLength(0);
    expect(
      groups.flatMap(({ issues }) => issues).map(({ id }) => id),
    ).toHaveLength(7);
  });

  it("keeps a zero-count Epic header when the Epic itself matches", () => {
    const descriptor = createIssueGroupDescriptor("epic", {
      labels,
      hierarchyCatalog: [
        {
          id: "REEF-100",
          title: "Empty Epic",
          status: "in_review",
          issue_type: "epic",
          parent_id: null,
          rank: null,
          depends_on: [],
        },
      ],
    });

    const [group] = descriptor.bucketsForIssues([
      issue("REEF-100", {
        issue_type: "epic",
        title: "Empty Epic",
        status: "in_review",
      }),
    ]);

    expect(group).toMatchObject({
      bucket: {
        id: "epic:REEF-100",
        epic: { id: "REEF-100" },
        progress: { done: 0, total: 0 },
      },
      issues: [],
    });
  });
});
