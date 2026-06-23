// @vitest-environment node
import type { IssueUpdatePatch } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  listQueryHasFreeText,
  patchAffectsActivityTimeline,
  patchAffectsListMembership,
  patchAffectsRelationGraph,
} from "./issueListMembership";

describe("patchAffectsListMembership", () => {
  it("is true for server facets and the sort field", () => {
    const facets: IssueUpdatePatch[] = [
      { status: "done" },
      { priority: "high" },
      { severity: "major" },
      { issue_type: "bug" },
      { assigned_to: "alice" },
      { requester: "bob" },
      { sprint_id: "spr-1" },
      { milestone_id: "ms-1" },
      { release_id: "rel-1" },
      { archived_at: "2026-01-01T00:00:00.000Z" },
    ];
    for (const patch of facets) {
      expect(patchAffectsListMembership(patch)).toBe(true);
    }
  });

  it("is false for non-membership content edits", () => {
    expect(patchAffectsListMembership({ title: "Renamed" })).toBe(false);
    expect(patchAffectsListMembership({ due_date: "2026-02-02" })).toBe(false);
    expect(patchAffectsListMembership({ labels: ["ui"] })).toBe(false);
    expect(patchAffectsListMembership({ estimate_points: 3 })).toBe(false);
    expect(patchAffectsListMembership({})).toBe(false);
  });
});

describe("patchAffectsRelationGraph", () => {
  it("is true for status / depends_on / blocks", () => {
    expect(patchAffectsRelationGraph({ status: "done" })).toBe(true);
    expect(patchAffectsRelationGraph({ depends_on: ["REEF-2"] })).toBe(true);
    expect(patchAffectsRelationGraph({ blocks: ["REEF-3"] })).toBe(true);
  });

  it("is false for edits that don't touch the relation projection", () => {
    expect(patchAffectsRelationGraph({ title: "x" })).toBe(false);
    expect(patchAffectsRelationGraph({ priority: "low" })).toBe(false);
  });
});

describe("patchAffectsActivityTimeline", () => {
  it("is true for every dimension that logs a reef_activity event", () => {
    const logged: IssueUpdatePatch[] = [
      { status: "done" },
      { assigned_to: "alice" },
      { priority: "high" },
      { milestone_id: "ms-1" },
      { sprint_id: "spr-1" },
      { release_id: "rel-1" },
      { implementation_refs: [] },
      { title: "Renamed" },
      { due_date: "2026-02-02" },
      { estimate_points: 3 },
      { parent_id: "REEF-2" },
      { archived_at: "2026-01-01T00:00:00.000Z" },
      { labels: ["ui"] },
      { depends_on: ["REEF-2"] },
      { blocks: ["REEF-3"] },
      { related_to: ["REEF-4"] },
    ];
    for (const patch of logged) {
      expect(patchAffectsActivityTimeline(patch)).toBe(true);
    }
  });

  it("is false for edits that append no activity event", () => {
    expect(patchAffectsActivityTimeline({ reporter: "bob" })).toBe(false);
    expect(patchAffectsActivityTimeline({ requester: "carol" })).toBe(false);
    expect(patchAffectsActivityTimeline({ issue_type: "bug" })).toBe(false);
    expect(patchAffectsActivityTimeline({ start_date: "2026-02-02" })).toBe(
      false,
    );
    expect(patchAffectsActivityTimeline({})).toBe(false);
  });
});

describe("listQueryHasFreeText", () => {
  it("detects a non-empty q facet in the query-key params", () => {
    expect(
      listQueryHasFreeText({
        queryKey: ["issues", "list", "v", { q: "login" }],
      }),
    ).toBe(true);
  });

  it("is false for plain, facet-only, or empty-q list keys", () => {
    expect(listQueryHasFreeText({ queryKey: ["issues", "list", "v"] })).toBe(
      false,
    );
    expect(
      listQueryHasFreeText({
        queryKey: ["issues", "list", "v", { status: ["todo"] }],
      }),
    ).toBe(false);
    expect(
      listQueryHasFreeText({ queryKey: ["issues", "list", "v", { q: "" }] }),
    ).toBe(false);
  });
});
