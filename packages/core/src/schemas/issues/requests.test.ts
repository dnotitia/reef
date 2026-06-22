import { describe, expect, it } from "vitest";
import {
  CreateIssueRequestSchema,
  IssueListQuerySchema,
  IssueListResponseSchema,
  hasAnyFilter,
} from "./requests";

const BASE_CREATE = { fields: { title: "T" }, content: "body" };
const DOC = "akb://v/coll/specs/doc/a.md";

describe("CreateIssueRequestSchema references (REEF-083 AC4)", () => {
  it("de-duplicates document references", () => {
    const parsed = CreateIssueRequestSchema.parse({
      vault: "v",
      prefix: "REEF",
      create: BASE_CREATE,
      references: [DOC, DOC],
    });
    expect(parsed.references).toEqual([DOC]);
  });

  it("caps the references array to guard against fan-out", () => {
    const many = Array.from(
      { length: 51 },
      (_, i) => `akb://v/coll/specs/doc/d${i}.md`,
    );
    expect(
      CreateIssueRequestSchema.safeParse({
        vault: "v",
        prefix: "REEF",
        create: BASE_CREATE,
        references: many,
      }).success,
    ).toBe(false);
  });

  it("rejects a non-document reference uri", () => {
    expect(
      CreateIssueRequestSchema.safeParse({
        vault: "v",
        prefix: "REEF",
        create: BASE_CREATE,
        references: ["https://example.com"],
      }).success,
    ).toBe(false);
  });

  it("rejects a reference targeting a different vault", () => {
    expect(
      CreateIssueRequestSchema.safeParse({
        vault: "v",
        prefix: "REEF",
        create: BASE_CREATE,
        references: ["akb://other/coll/specs/doc/a.md"],
      }).success,
    ).toBe(false);
  });
});

describe("IssueListQuerySchema", () => {
  it("applies defaults for an empty query", () => {
    const parsed = IssueListQuerySchema.parse({});
    expect(parsed.archived).toBe(false);
    expect(parsed.default_view).toBe(false);
    expect(parsed.sort_field).toBeUndefined();
    expect(parsed.sort_order).toBeUndefined();
    expect(parsed.limit).toBeUndefined();
  });

  it("accepts multi-value facets as arrays", () => {
    const parsed = IssueListQuerySchema.parse({
      status: ["todo", "in_progress"],
      priority: ["high"],
    });
    expect(parsed.status).toEqual(["todo", "in_progress"]);
    expect(parsed.priority).toEqual(["high"]);
  });

  it("accepts multi-value people/planning facets as arrays (REEF-267)", () => {
    const parsed = IssueListQuerySchema.parse({
      assigned_to: ["alice", "bob"],
      requester: ["carol"],
      sprint_id: ["s1", "s2"],
      release_id: ["r1"],
      milestone_id: "m1",
    });
    expect(parsed.assigned_to).toEqual(["alice", "bob"]);
    expect(parsed.requester).toEqual(["carol"]);
    expect(parsed.sprint_id).toEqual(["s1", "s2"]);
    expect(parsed.release_id).toEqual(["r1"]);
    // milestone_id stays a single scalar (multi-select out of scope, REEF-267).
    expect(parsed.milestone_id).toBe("m1");
  });

  it("rejects an out-of-range limit", () => {
    expect(() => IssueListQuerySchema.parse({ limit: 0 })).toThrow();
    expect(() => IssueListQuerySchema.parse({ limit: 101 })).toThrow();
  });

  it("rejects an unknown sort field or status member", () => {
    expect(() => IssueListQuerySchema.parse({ sort_field: "nope" })).toThrow();
    expect(() => IssueListQuerySchema.parse({ status: ["bogus"] })).toThrow();
  });

  it("rejects a malformed cursor and accepts a well-formed one", () => {
    expect(() =>
      IssueListQuerySchema.parse({ cursor: "not-base64-json" }),
    ).toThrow();
    const valid = Buffer.from(
      JSON.stringify({ k: "x", id: "REEF-1" }),
    ).toString("base64url");
    expect(IssueListQuerySchema.parse({ cursor: valid }).cursor).toBe(valid);
  });
});

describe("hasAnyFilter", () => {
  it("is false for the default (no narrowing facets)", () => {
    expect(hasAnyFilter(IssueListQuerySchema.parse({}))).toBe(false);
  });

  it("ignores the widening archived toggle and sort/pagination", () => {
    const query = IssueListQuerySchema.parse({
      archived: true,
      sort_field: "due_date",
      limit: 10,
    });
    expect(hasAnyFilter(query)).toBe(false);
  });

  it("is true when any narrowing facet is present", () => {
    expect(hasAnyFilter(IssueListQuerySchema.parse({ status: ["todo"] }))).toBe(
      true,
    );
    expect(
      hasAnyFilter(IssueListQuerySchema.parse({ assigned_to: ["alice"] })),
    ).toBe(true);
    expect(hasAnyFilter(IssueListQuerySchema.parse({ q: "login" }))).toBe(true);
  });
});

describe("IssueListResponseSchema", () => {
  it("accepts a paginated page with null cursor and counts", () => {
    const parsed = IssueListResponseSchema.parse({
      issues: [],
      next_cursor: null,
      column_counts: { open: 3, done: 1 },
    });
    expect(parsed.next_cursor).toBeNull();
    expect(parsed.column_counts).toEqual({ open: 3, done: 1 });
  });

  it("accepts the older unpaginated shape (issues only)", () => {
    const parsed = IssueListResponseSchema.parse({ issues: [] });
    expect(parsed.issues).toEqual([]);
    expect(parsed.next_cursor).toBeUndefined();
    expect(parsed.column_counts).toBeUndefined();
  });
});
