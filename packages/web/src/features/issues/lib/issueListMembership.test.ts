// @vitest-environment node
import type { IssueUpdatePatch } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  changedListMembershipKeys,
  listMembershipInvalidationPredicate,
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

describe("listMembershipInvalidationPredicate", () => {
  const key = (params?: Record<string, unknown>) => ({
    queryKey: params
      ? (["issues", "list", "v", params] as const)
      : (["issues", "list", "v"] as const),
  });

  it("never refetches the bare full list (no query fragment)", () => {
    const predicate = listMembershipInvalidationPredicate(["status"]);
    expect(predicate(key())).toBe(false);
  });

  it("refetches a variant that filters on a changed key", () => {
    const predicate = listMembershipInvalidationPredicate(["status"]);
    expect(predicate(key({ status: ["todo"], sort_field: "created_at" }))).toBe(
      true,
    );
  });

  it("skips a variant whose facets do not include any changed key", () => {
    // priority edit; this variant filters by assignee and sorts by created_at,
    // so it neither gains/loses the issue nor reorders — stays patched in place.
    const predicate = listMembershipInvalidationPredicate(["assigned_to"]);
    expect(predicate(key({ status: ["todo"], sort_field: "created_at" }))).toBe(
      false,
    );
  });

  it("refetches every sorted variant on a priority edit (default sort)", () => {
    const predicate = listMembershipInvalidationPredicate(["priority"]);
    expect(predicate(key({ status: ["todo"], sort_field: "priority" }))).toBe(
      true,
    );
  });

  it("refetches an updated_at-sorted variant on any edit (server-stamped)", () => {
    // `updated_at` is bumped by the server on every edit, so an updated_at-sorted
    // list reorders even when the changed field is neither its facet nor sort.
    const predicate = listMembershipInvalidationPredicate(["status"]);
    expect(
      predicate(key({ assigned_to: ["alice"], sort_field: "updated_at" })),
    ).toBe(true);
  });

  it("refetches active variants but not widened ones on archive/restore", () => {
    const predicate = listMembershipInvalidationPredicate(["archived_at"]);
    // An active variant omits `archived`, so it filters `archived_at IS NULL`
    // server-side: a restore adds (an archive removes) the row, which the
    // in-place patch does not do → refetch.
    expect(predicate(key({ status: ["todo"], sort_field: "created_at" }))).toBe(
      true,
    );
    // A widened variant (`archived: "true"`) shows both scopes, so archive /
    // restore leaves its membership unchanged → no refetch.
    expect(predicate(key({ archived: "true", sort_field: "created_at" }))).toBe(
      false,
    );
    // The bare full list sends no `archived` param → every issue regardless of
    // archived state → membership unchanged.
    expect(predicate(key())).toBe(false);
  });

  it("always refetches a free-text (q) variant", () => {
    const predicate = listMembershipInvalidationPredicate(["assigned_to"]);
    expect(predicate(key({ q: "login", sort_field: "created_at" }))).toBe(true);
  });

  it("defensively refetches a default_view variant", () => {
    const predicate = listMembershipInvalidationPredicate(["status"]);
    expect(
      predicate(key({ default_view: "true", sort_field: "priority" })),
    ).toBe(true);
  });
});
