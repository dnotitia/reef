// @vitest-environment node
import type { IssueUpdatePatch } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  changedListMembershipKeys,
  listInvalidationPredicate,
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

describe("changedListMembershipKeys", () => {
  it("returns only the membership keys present in the patch", () => {
    expect(changedListMembershipKeys({ status: "done", title: "x" })).toEqual([
      "status",
    ]);
    expect(
      changedListMembershipKeys({ priority: "high", assigned_to: "alice" }),
    ).toEqual(["priority", "assigned_to"]);
  });

  it("is empty for a purely non-membership patch", () => {
    expect(changedListMembershipKeys({ title: "x", labels: ["ui"] })).toEqual(
      [],
    );
    expect(changedListMembershipKeys({})).toEqual([]);
  });

  it("stays in lockstep with the patchAffectsListMembership gate", () => {
    expect(changedListMembershipKeys({ sprint_id: "s" }).length > 0).toBe(
      patchAffectsListMembership({ sprint_id: "s" }),
    );
    expect(changedListMembershipKeys({ title: "x" }).length > 0).toBe(
      patchAffectsListMembership({ title: "x" }),
    );
  });
});

describe("listInvalidationPredicate", () => {
  const key = (params?: Record<string, unknown>) => ({
    queryKey: params
      ? (["issues", "list", "v", params] as const)
      : (["issues", "list", "v"] as const),
  });

  describe("membership edits (server facets / sort field)", () => {
    it("never refetches the bare full list (no query fragment)", () => {
      const predicate = listInvalidationPredicate({ status: "done" });
      expect(predicate(key())).toBe(false);
    });

    it("refetches a variant that filters on a changed facet key", () => {
      const predicate = listInvalidationPredicate({ status: "done" });
      expect(
        predicate(key({ status: ["todo"], sort_field: "created_at" })),
      ).toBe(true);
    });

    it("skips a variant whose facets do not include any changed key", () => {
      // assignee edit; this variant filters by status and sorts by created_at,
      // so it neither gains/loses the issue nor reorders — stays patched.
      const predicate = listInvalidationPredicate({ assigned_to: "alice" });
      expect(
        predicate(key({ status: ["todo"], sort_field: "created_at" })),
      ).toBe(false);
    });

    it("refetches a priority-sorted variant on a priority edit (default sort)", () => {
      const predicate = listInvalidationPredicate({ priority: "high" });
      expect(predicate(key({ status: ["todo"], sort_field: "priority" }))).toBe(
        true,
      );
    });

    it("refetches active variants but not widened ones on archive/restore", () => {
      const predicate = listInvalidationPredicate({
        archived_at: "2026-01-01T00:00:00.000Z",
      });
      // An active variant omits `archived`, so it filters `archived_at IS NULL`
      // server-side: a restore adds (an archive removes) the row, which the
      // in-place patch does not do → refetch.
      expect(
        predicate(key({ status: ["todo"], sort_field: "created_at" })),
      ).toBe(true);
      // A widened variant (`archived: "true"`) shows both scopes, so archive /
      // restore leaves its membership unchanged → no refetch.
      expect(
        predicate(key({ archived: "true", sort_field: "created_at" })),
      ).toBe(false);
      // The bare full list sends no `archived` param → every issue regardless of
      // archived state → membership unchanged.
      expect(predicate(key())).toBe(false);
    });

    it("defensively refetches a default_view variant on a membership edit", () => {
      const predicate = listInvalidationPredicate({ status: "done" });
      expect(
        predicate(key({ default_view: "true", sort_field: "priority" })),
      ).toBe(true);
    });
  });

  describe("non-membership edits reorder sorted variants (REEF-325)", () => {
    it("refetches an updated_at-sorted variant on any edit (server-stamped)", () => {
      // Every successful edit bumps the server-stamped `updated_at`, so a
      // "recently updated" list reorders after a title/date/estimate edit — the
      // gap the old non-membership branch (q-only) left stale.
      const predicate = listInvalidationPredicate({ title: "Renamed" });
      expect(predicate(key({ sort_field: "updated_at" }))).toBe(true);
    });

    it("refetches a variant sorted by the edited non-membership field", () => {
      const predicate = listInvalidationPredicate({ due_date: "2026-02-02" });
      expect(predicate(key({ sort_field: "due_date" }))).toBe(true);
    });

    it("skips a variant sorted by an unedited field on a non-membership edit", () => {
      // A title edit does not reorder a created_at-sorted list and does not
      // change the status facet's membership → stays patched.
      const predicate = listInvalidationPredicate({ title: "Renamed" });
      expect(
        predicate(key({ status: ["todo"], sort_field: "created_at" })),
      ).toBe(false);
    });

    it("never refetches the bare full list on a non-membership edit", () => {
      const predicate = listInvalidationPredicate({ due_date: "2026-02-02" });
      expect(predicate(key())).toBe(false);
    });

    it("does not refetch a default_view variant on a pure content edit", () => {
      // default_view scope (active sprint / open statuses / my-issues) cannot
      // change from a title edit, so it is not refetched — unlike a membership
      // edit above.
      const predicate = listInvalidationPredicate({ title: "Renamed" });
      expect(
        predicate(key({ default_view: "true", sort_field: "created_at" })),
      ).toBe(false);
    });

    it("still refetches a free-text (q) variant on a content edit", () => {
      const predicate = listInvalidationPredicate({ title: "Renamed" });
      expect(predicate(key({ q: "login", sort_field: "created_at" }))).toBe(
        true,
      );
    });

    it("refetches variants sorted by any edited field on a combined edit", () => {
      // A single patch touching a membership key and a non-membership sort field
      // reorders both a priority-sorted and a due_date-sorted variant — the
      // unified predicate covers the edited-field set, not just membership keys.
      const predicate = listInvalidationPredicate({
        priority: "high",
        due_date: "2026-02-02",
      });
      expect(predicate(key({ sort_field: "priority" }))).toBe(true);
      expect(predicate(key({ sort_field: "due_date" }))).toBe(true);
    });
  });
});
