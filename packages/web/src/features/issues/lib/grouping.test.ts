import type { IssueListItem } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  createIssueGroupDescriptor,
  groupIssues,
  projectStatusHierarchy,
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
});

describe("status hierarchy projection", () => {
  const descriptor = createIssueGroupDescriptor("status", { labels });

  it("renders one visible epic lane and places only direct children in status buckets", () => {
    const issues = [
      issue("independent", { status: "todo" }),
      issue("epic", {
        issue_type: "epic",
        title: "Outcome",
        status: "in_progress",
      }),
      issue("child-todo", { parent_id: "epic", status: "todo" }),
      issue("child-done", { parent_id: "epic", status: "done" }),
      issue("child-closed", { parent_id: "epic", status: "closed" }),
      issue("grandchild", { parent_id: "child-todo", status: "todo" }),
    ];
    const projection = projectStatusHierarchy(
      descriptor.bucketsForIssues(issues),
      issues,
    );

    expect(projection.epicLanes).toHaveLength(1);
    expect(projection.epicLanes[0]).toMatchObject({
      epic: issues[1],
      totalChildren: 3,
      completedChildren: 2,
      statusCounts: { todo: 1, done: 1, closed: 1 },
    });
    expect(
      projection.epicLanes[0]?.children.flatMap(({ issues: children }) =>
        children.map(({ id }) => id),
      ),
    ).toEqual(["child-todo", "child-done", "child-closed"]);
    expect(
      projection.rootGroups.flatMap(({ issues: rootIssues }) =>
        rootIssues.map(({ id }) => id),
      ),
    ).toEqual(["independent", "grandchild"]);
  });

  it("keeps filtered-out parents, missing parents, non-epic parents, and deeper chains flat", () => {
    const issues = [
      issue("visible-epic", { issue_type: "epic" }),
      issue("visible-child", { parent_id: "visible-epic" }),
      issue("filtered-child", { parent_id: "visible-epic", status: "done" }),
      issue("non-epic-parent", { issue_type: "story" }),
      issue("non-epic-child", { parent_id: "non-epic-parent" }),
      issue("missing-parent-child", { parent_id: "missing-parent" }),
      issue("deeper-child", { parent_id: "visible-child" }),
    ];
    const visible = issues.filter(({ id }) => id !== "filtered-child");
    const projection = projectStatusHierarchy(
      descriptor.bucketsForIssues(visible),
      visible,
    );

    expect(projection.epicLanes).toHaveLength(1);
    expect(projection.epicLanes[0]?.totalChildren).toBe(1);
    expect(
      projection.rootGroups.flatMap(({ issues: rootIssues }) =>
        rootIssues.map(({ id }) => id),
      ),
    ).toEqual([
      "non-epic-parent",
      "non-epic-child",
      "missing-parent-child",
      "deeper-child",
    ]);
    expect(projection.fallbackByIssueId).toEqual(
      new Map([
        ["non-epic-child", "non_epic_parent"],
        ["missing-parent-child", "missing_parent"],
        ["deeper-child", "deeper_chain"],
      ]),
    );

    const allRenderedIds = [
      ...projection.rootGroups.flatMap(({ issues: rootIssues }) =>
        rootIssues.map(({ id }) => id),
      ),
      ...projection.epicLanes.flatMap(({ epic, children }) => [
        epic.id,
        ...children.flatMap(({ issues: childIssues }) =>
          childIssues.map(({ id }) => id),
        ),
      ]),
    ];
    expect(new Set(allRenderedIds).size).toBe(allRenderedIds.length);
  });
});
