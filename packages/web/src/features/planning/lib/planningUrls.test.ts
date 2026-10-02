// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  planningIssueFilterHref,
  planningListDetailHref,
  planningListHref,
  sprintDetailHref,
} from "./planningUrls";

describe("planning detail URLs", () => {
  it("keeps sprint details on the vault-owned dedicated route", () => {
    expect(sprintDetailHref("reef-acme", "sprint-1")).toBe(
      "/workspace/reef-acme/planning/sprints/sprint-1",
    );
  });

  it("opens milestone and release details in the List view", () => {
    expect(planningListHref("reef-acme", "milestones")).toBe(
      "/workspace/reef-acme/planning?view=list&kind=milestones",
    );
    expect(
      planningListDetailHref("reef-acme", "milestones", "milestone-1"),
    ).toBe(
      "/workspace/reef-acme/planning?view=list&kind=milestones&detail=milestone-1",
    );
    expect(planningListDetailHref("reef-acme", "releases", "release-1")).toBe(
      "/workspace/reef-acme/planning?view=list&kind=releases&detail=release-1",
    );
  });

  it.each([
    ["sprints", "sprint_id"],
    ["milestones", "milestone_id"],
    ["releases", "release_id"],
  ] as const)("builds the %s Issues filter", (kind, filter) => {
    expect(planningIssueFilterHref("reef-acme", kind, "item-1")).toBe(
      `/workspace/reef-acme/issues?${filter}=item-1`,
    );
  });
});
