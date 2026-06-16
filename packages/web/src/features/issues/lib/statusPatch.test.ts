// @vitest-environment node

import type { IssueMetadata } from "@reef/core";
import { describe, expect, it } from "vitest";
import { buildStatusPatch } from "./statusPatch";

const baseIssue = {
  id: "REEF-001",
  title: "Sample issue",
  status: "todo",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
} satisfies IssueMetadata;

describe("buildStatusPatch", () => {
  it("returns only the status patch for non-closed transitions", () => {
    expect(
      buildStatusPatch(baseIssue, "in_progress", "2026-05-28T01:02:03.000Z"),
    ).toEqual({
      status: "in_progress",
    });
  });

  it("sets the selected close reason when transitioning to closed", () => {
    expect(
      buildStatusPatch(baseIssue, "closed", "2026-05-28T01:02:03.000Z"),
    ).toEqual({
      status: "closed",
      closed_reason: "completed",
    });
  });

  it("uses the selected close reason", () => {
    expect(
      buildStatusPatch(
        baseIssue,
        "closed",
        "2026-05-28T01:02:03.000Z",
        "duplicate",
      ),
    ).toMatchObject({
      closed_reason: "duplicate",
    });
  });

  it("returns only the target status when reopening a closed issue", () => {
    expect(
      buildStatusPatch(
        {
          ...baseIssue,
          status: "closed",
          closed_at: "2026-05-20T00:00:00.000Z",
          closed_reason: "completed",
        },
        "todo",
        "2026-05-28T01:02:03.000Z",
      ),
    ).toEqual({
      status: "todo",
    });
  });
});
