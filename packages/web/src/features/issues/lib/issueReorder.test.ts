// @vitest-environment node

import type { IssueListItem } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  buildIssueReorderTargetForBoardDrop,
  buildIssueReorderTargetForDrop,
  buildIssueReorderTargetFromDrop,
  resolveIssueReorderTargetForDrop,
} from "./issueReorder";

function issue(
  id: string,
  rank: number | null,
  createdAt = "2026-05-01T00:00:00.000Z",
): IssueListItem {
  return {
    id,
    title: id,
    status: "todo",
    rank,
    created_at: createdAt,
    created_by: "alice",
    updated_at: createdAt,
    updated_by: "alice",
  };
}

describe("issue reorder target", () => {
  it("keeps the target as anchors instead of serializing an id sequence", () => {
    const items = [
      issue("REEF-001", 1000),
      issue("REEF-002", 2000),
      issue("REEF-003", 3000),
    ];

    expect(
      buildIssueReorderTargetFromDrop(items, "REEF-003", "REEF-002"),
    ).toEqual({
      issueId: "REEF-003",
      beforeId: "REEF-001",
      afterId: "REEF-002",
      expected: {
        issueRank: 3000,
        issueUpdatedAt: "2026-05-01T00:00:00.000Z",
        beforeRank: 1000,
        beforeUpdatedAt: "2026-05-01T00:00:00.000Z",
        afterRank: 2000,
        afterUpdatedAt: "2026-05-01T00:00:00.000Z",
      },
    });
  });

  it("inserts a cross-group issue before the hovered target", () => {
    const moved = issue("REEF-009", 9000);
    const target = [issue("REEF-010", 1000), issue("REEF-011", 2000)];

    expect(
      buildIssueReorderTargetForDrop(moved, target, "REEF-011"),
    ).toMatchObject({
      issueId: "REEF-009",
      beforeId: "REEF-010",
      afterId: "REEF-011",
    });
  });

  it("uses a loaded hidden canonical row as the after anchor at a filtered boundary", () => {
    const visible = [issue("REEF-001", 1000), issue("REEF-002", 2000)];
    const canonical = [...visible, issue("REEF-003", 3000)];
    const result = resolveIssueReorderTargetForDrop(
      visible,
      canonical,
      "REEF-001",
      "REEF-002",
      true,
    );

    expect(result.needsMoreCanonicalItems).toBe(false);
    expect(result.target).toMatchObject({
      beforeId: "REEF-002",
      afterId: "REEF-003",
    });
  });

  it("keeps hidden canonical rows between filtered neighbours", () => {
    const visible = [issue("REEF-001", 1000), issue("REEF-003", 3000)];
    const canonical = [
      issue("REEF-001", 1000),
      issue("REEF-002", 2000),
      issue("REEF-003", 3000),
      issue("REEF-004", 4000),
    ];
    const result = resolveIssueReorderTargetForDrop(
      visible,
      canonical,
      "REEF-001",
      "REEF-003",
      true,
    );

    expect(result.needsMoreCanonicalItems).toBe(false);
    expect(result.target).toMatchObject({
      beforeId: "REEF-003",
      afterId: "REEF-004",
    });
  });

  it("uses the moved issue's canonical edge when a Board bucket is empty", () => {
    const moved = issue("REEF-003", 3000);
    const canonical = [issue("REEF-001", 1000), moved];

    expect(
      buildIssueReorderTargetForBoardDrop(moved, [], canonical),
    ).toMatchObject({
      issueId: "REEF-003",
      beforeId: "REEF-001",
      afterId: null,
    });
  });

  it("fills a Board group edge with the next canonical row", () => {
    const moved = issue("REEF-003", 5000);
    const targetItems = [issue("REEF-001", 1000)];
    const canonical = [targetItems[0], issue("REEF-002", 2000), moved];

    expect(
      buildIssueReorderTargetForBoardDrop(moved, targetItems, canonical),
    ).toMatchObject({
      beforeId: "REEF-001",
      afterId: "REEF-002",
    });
  });

  it("blocks a visible-tail drop while the next canonical page is unknown", () => {
    const visible = [issue("REEF-001", 1000), issue("REEF-002", 2000)];
    const result = resolveIssueReorderTargetForDrop(
      visible,
      visible,
      "REEF-001",
      "REEF-002",
      true,
    );

    expect(result).toEqual({
      target: null,
      needsMoreCanonicalItems: true,
    });
  });
});
