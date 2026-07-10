// @vitest-environment node

import type { IssueListItem } from "@reef/core";
import { describe, expect, it } from "vitest";
import { buildBulkIssuePatch } from "./bulkIssueUpdate";

const ISSUE = {
  id: "REEF-001",
  title: "Issue",
  status: "backlog",
  priority: "medium",
  assigned_to: "alice",
  sprint_id: null,
  labels: ["ui", "Risk"],
  created_at: "2026-01-01T00:00:00Z",
  created_by: "alice",
  updated_at: "2026-01-01T00:00:00Z",
  updated_by: "alice",
} satisfies IssueListItem;

describe("buildBulkIssuePatch", () => {
  it("skips no-op scalar changes and supports clears", () => {
    expect(
      buildBulkIssuePatch(ISSUE, { kind: "assignee", value: "alice" }),
    ).toBeNull();
    expect(
      buildBulkIssuePatch(ISSUE, { kind: "priority", value: null }),
    ).toEqual({ priority: null });
  });

  it("maintains the sprint-backlog invariant in both directions", () => {
    expect(
      buildBulkIssuePatch(ISSUE, { kind: "sprint", value: "sprint-1" }),
    ).toEqual({
      sprint_id: "sprint-1",
      status: "todo",
    });
    expect(
      buildBulkIssuePatch(
        { ...ISSUE, status: "todo", sprint_id: "sprint-1" },
        { kind: "status", value: "backlog" },
      ),
    ).toEqual({ status: "backlog", sprint_id: null });
  });

  it("adds labels as a stable case-insensitive union and removes by difference", () => {
    expect(
      buildBulkIssuePatch(ISSUE, {
        kind: "labels:add",
        value: ["risk", "new"],
      }),
    ).toEqual({
      labels: ["ui", "Risk", "new"],
    });
    expect(
      buildBulkIssuePatch(ISSUE, { kind: "labels:remove", value: ["RISK"] }),
    ).toEqual({
      labels: ["ui"],
    });
  });

  it("adds one close reason to each close patch", () => {
    expect(
      buildBulkIssuePatch(
        { ...ISSUE, status: "todo" },
        { kind: "status", value: "closed", closedReason: "duplicate" },
      ),
    ).toEqual({ status: "closed", closed_reason: "duplicate" });
  });
});
