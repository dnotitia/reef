import { describe, expect, it } from "vitest";
import {
  PersistedIssueFilterEnvelopeSchema,
  PersistedIssueFilterSchema,
} from "./persistedIssueFilter";

describe("PersistedIssueFilterSchema", () => {
  it("round-trips a fully populated valid filter", () => {
    const input = {
      status: ["todo"],
      issueType: ["bug"],
      priority: ["high"],
      // assignee / requester / sprint_id / release_id are multi-select arrays
      // (REEF-267); milestone_id stays a single scalar.
      assignee: ["alice", "carol"],
      requester: ["bob"],
      reporter: "carol",
      severity: ["major"],
      sprint_id: ["spr-1", "spr-2"],
      milestone_id: "mil-1",
      release_id: ["rel-1"],
      due: ["overdue"],
      label: "ui",
      dependencyFilter: ["blocked"],
      showArchived: true,
      sortField: "updated_at",
      sortOrder: "desc",
    };
    expect(PersistedIssueFilterSchema.parse(input)).toEqual(input);
  });

  it("drops a stale-enum facet while keeping valid sibling facets (AC5)", () => {
    const parsed = PersistedIssueFilterSchema.parse({
      status: ["archived"], // no longer a valid status enum member
      priority: ["high"],
    });
    expect(parsed.status).toBeUndefined();
    expect(parsed.priority).toEqual(["high"]);
  });

  it("normalizes a older single-scalar facet to a one-element array (REEF-031 old-shape)", () => {
    // Pre-REEF-031 saved filters stored facets as a single string. An upgrade
    // should preserve them, not drop them to undefined.
    const parsed = PersistedIssueFilterSchema.parse({
      status: "in_progress",
      priority: "high",
      due: "overdue",
      dependencyFilter: "blocked",
    });
    expect(parsed.status).toEqual(["in_progress"]);
    expect(parsed.priority).toEqual(["high"]);
    expect(parsed.due).toEqual(["overdue"]);
    expect(parsed.dependencyFilter).toEqual(["blocked"]);
  });

  it("still drops a older single scalar that is no longer a valid enum member", () => {
    expect(
      PersistedIssueFilterSchema.parse({ status: "archived" }).status,
    ).toBeUndefined();
  });

  it("strips unknown/removed fields (AC5)", () => {
    const parsed = PersistedIssueFilterSchema.parse({
      foo: "bar",
      status: ["todo"],
    } as Record<string, unknown>);
    expect((parsed as Record<string, unknown>).foo).toBeUndefined();
    expect(parsed.status).toEqual(["todo"]);
  });

  it("keeps a dangling reference id and widens a pre-REEF-267 scalar to an array", () => {
    // A string id that no longer resolves still validates (existence is not
    // checked), and a pre-REEF-267 saved scalar assignee/sprint upgrades to a
    // one-element array rather than being dropped (multiStringFacet coercion).
    const parsed = PersistedIssueFilterSchema.parse({
      assignee: "ghost-user",
      sprint_id: "spr-does-not-exist",
    });
    expect(parsed.assignee).toEqual(["ghost-user"]);
    expect(parsed.sprint_id).toEqual(["spr-does-not-exist"]);
  });

  it("drops a `rank` sort (not user-selectable) but keeps a valid sort", () => {
    expect(
      PersistedIssueFilterSchema.parse({ sortField: "rank" }).sortField,
    ).toBeUndefined();
    expect(
      PersistedIssueFilterSchema.parse({ sortField: "due_date" }).sortField,
    ).toBe("due_date");
  });

  it("drops a wrong-typed value to undefined", () => {
    const parsed = PersistedIssueFilterSchema.parse({
      showArchived: "yes", // not a boolean
      assignee: 42, // not a string
    } as Record<string, unknown>);
    expect(parsed.showArchived).toBeUndefined();
    expect(parsed.assignee).toBeUndefined();
  });

  it("parses an empty object to all-undefined", () => {
    const parsed = PersistedIssueFilterSchema.parse({});
    expect(Object.values(parsed).every((v) => v === undefined)).toBe(true);
  });
});

describe("PersistedIssueFilterEnvelopeSchema", () => {
  it("accepts version 1 with a valid filter", () => {
    const result = PersistedIssueFilterEnvelopeSchema.safeParse({
      version: 1,
      filter: { status: ["todo"] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a mismatched version (forces a hard discard on restore)", () => {
    expect(
      PersistedIssueFilterEnvelopeSchema.safeParse({ version: 2, filter: {} })
        .success,
    ).toBe(false);
  });

  it("rejects a non-object payload", () => {
    expect(PersistedIssueFilterEnvelopeSchema.safeParse("nope").success).toBe(
      false,
    );
    expect(PersistedIssueFilterEnvelopeSchema.safeParse(null).success).toBe(
      false,
    );
  });

  it("rejects a missing version", () => {
    expect(
      PersistedIssueFilterEnvelopeSchema.safeParse({ filter: {} }).success,
    ).toBe(false);
  });
});
