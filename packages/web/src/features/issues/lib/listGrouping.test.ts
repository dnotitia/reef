import type { IssueListItem } from "@reef/core";
import { describe, expect, it } from "vitest";
import { createIssueGroupDescriptor } from "./grouping";
import { buildIssueListVirtualItems } from "./listGrouping";

function issue(id: string, labels: string[] = []): IssueListItem {
  return {
    id,
    title: id,
    status: "todo",
    labels,
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: "tester",
    updated_at: "2026-01-01T00:00:00.000Z",
    updated_by: "tester",
  };
}

const descriptorOptions = {
  labels: {
    none: "None",
    status: {},
    priority: {},
  },
};

describe("List grouping virtual projection", () => {
  it("puts sticky headers and rows in one logical virtual item model", () => {
    const descriptor = createIssueGroupDescriptor("label", descriptorOptions);
    const groups = descriptor.bucketsForIssues([
      issue("one", ["Zebra", "alpha"]),
      issue("two", ["Zebra"]),
      issue("none"),
    ]);

    const items = buildIssueListVirtualItems(groups, new Set());
    expect(items.map((item) => item.kind)).toEqual([
      "header",
      "issue",
      "header",
      "issue",
      "issue",
      "header",
      "issue",
    ]);
    expect(
      items.filter((item) => item.kind === "header").map((item) => item.count),
    ).toEqual([1, 2, 1]);
    expect(
      items.filter((item) => item.kind === "issue").map((item) => item.key),
    ).toEqual([
      "label:alpha:one",
      "label:Zebra:one",
      "label:Zebra:two",
      "label:none:none",
    ]);
  });

  it("removes collapsed rows from the virtual model while retaining the header count", () => {
    const descriptor = createIssueGroupDescriptor("label", descriptorOptions);
    const groups = descriptor.bucketsForIssues([
      issue("one", ["Zebra"]),
      issue("two", ["Zebra"]),
    ]);
    const zebra = groups.find(({ bucket }) => bucket.value === "Zebra");
    const items = buildIssueListVirtualItems(
      groups,
      new Set(zebra ? [zebra.bucket.id] : []),
    );

    expect(
      items.find(
        (item) => item.kind === "header" && item.bucket.value === "Zebra",
      ),
    ).toMatchObject({
      count: 2,
      collapsed: true,
    });
    expect(
      items
        .filter((item) => item.kind === "issue")
        .map((item) => item.issue.id),
    ).toEqual([]);
  });

  it("keeps the flat List projection for group=none", () => {
    const descriptor = createIssueGroupDescriptor("none", descriptorOptions);
    const groups = descriptor.bucketsForIssues([issue("one"), issue("two")]);

    expect(buildIssueListVirtualItems(groups, new Set())).toMatchObject([
      { kind: "issue", key: "one", issue: { id: "one" } },
      { kind: "issue", key: "two", issue: { id: "two" } },
    ]);
  });

  it("retains a zero-count Epic header in the virtual model", () => {
    const descriptor = createIssueGroupDescriptor("epic", {
      labels: {
        ...descriptorOptions.labels,
        epic: { none: "No epic", unavailableParent: "Unavailable parent" },
      },
      hierarchyCatalog: [
        {
          id: "REEF-100",
          title: "Empty Epic",
          status: "todo",
          issue_type: "epic",
          parent_id: null,
          rank: 1,
          depends_on: [],
        },
      ],
    });
    const groups = descriptor.bucketsForIssues([issue("REEF-100")]);

    expect(buildIssueListVirtualItems(groups, new Set())).toMatchObject([
      {
        kind: "header",
        key: "epic:REEF-100:header",
        count: 0,
        collapsed: false,
      },
    ]);
  });
});
