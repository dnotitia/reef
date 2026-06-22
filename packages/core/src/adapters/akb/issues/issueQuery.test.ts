import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeTestAkbAdapter,
  setupFetch,
} from "../../../agents/tools/__test-helpers__/fetchMock";
import { IssueListQuerySchema } from "../../../schemas/issues/requests";
import {
  buildIssueOrderBy,
  buildIssueWhere,
  buildKeysetWhere,
  countIssuesByColumn,
  decodeCursor,
  encodeCursor,
  priorityRankCase,
} from "../core/shared";

const parse = (q: Record<string, unknown>) => IssueListQuerySchema.parse(q);

describe("buildIssueWhere", () => {
  it("adds the archived_at IS NULL floor by default (no facets)", () => {
    expect(buildIssueWhere(parse({}))).toBe(`"archived_at" IS NULL`);
  });

  it("omits the archived floor when archived=true and no facets", () => {
    expect(buildIssueWhere(parse({ archived: true }))).toBeUndefined();
  });

  it("renders a multi-value status IN list", () => {
    expect(
      buildIssueWhere(
        parse({ status: ["todo", "in_progress"], archived: true }),
      ),
    ).toBe(`"status" IN ('todo', 'in_progress')`);
  });

  it("treats issue_type=task as matching NULL rows too", () => {
    expect(
      buildIssueWhere(parse({ issue_type: ["task"], archived: true })),
    ).toBe(`("issue_type" = 'task' OR "issue_type" IS NULL)`);
  });

  it("uses exact equality for a non-task issue_type", () => {
    expect(
      buildIssueWhere(parse({ issue_type: ["bug"], archived: true })),
    ).toBe(`"issue_type" = 'bug'`);
  });

  it("uses a case-insensitive exact IN for assigned_to (REEF-267, no longer substring)", () => {
    // Exact match, not the old `ILIKE '%ali%'` substring — so scoping to `ali`
    // never incidentally returns `alice` / `khalil`.
    expect(
      buildIssueWhere(parse({ assigned_to: ["ali"], archived: true })),
    ).toBe(`LOWER("assigned_to") IN ('ali')`);
  });

  it("OR-combines a multi-value assigned_to facet and folds case (REEF-267)", () => {
    expect(
      buildIssueWhere(parse({ assigned_to: ["Alice", "BOB"], archived: true })),
    ).toBe(`LOWER("assigned_to") IN ('alice', 'bob')`);
  });

  it("uses a case-insensitive exact IN for requester (REEF-267)", () => {
    expect(
      buildIssueWhere(parse({ requester: ["carol", "dave"], archived: true })),
    ).toBe(`LOWER("requester") IN ('carol', 'dave')`);
  });

  it("renders a multi-value sprint_id IN list (REEF-267)", () => {
    expect(
      buildIssueWhere(parse({ sprint_id: ["s1", "s2"], archived: true })),
    ).toBe(`"sprint_id" IN ('s1', 's2')`);
  });

  it("renders a multi-value release_id IN list (REEF-267)", () => {
    expect(
      buildIssueWhere(parse({ release_id: ["r1", "r2"], archived: true })),
    ).toBe(`"release_id" IN ('r1', 'r2')`);
  });

  it("keeps milestone_id a single exact match (multi-select out of scope, REEF-267)", () => {
    expect(buildIssueWhere(parse({ milestone_id: "m1", archived: true }))).toBe(
      `"milestone_id" = 'm1'`,
    );
  });

  it("escapes LIKE metacharacters in the value", () => {
    expect(buildIssueWhere(parse({ q: "50%_x", archived: true }))).toContain(
      `'%50\\%\\_x%'`,
    );
  });

  it("escapes a literal backslash in the value (ESCAPE-clause safety)", () => {
    expect(buildIssueWhere(parse({ q: "a\\b", archived: true }))).toContain(
      `'%a\\\\b%'`,
    );
  });

  it("escapes single quotes (injection-safe)", () => {
    expect(buildIssueWhere(parse({ sprint_id: ["a'b"], archived: true }))).toBe(
      `"sprint_id" IN ('a''b')`,
    );
  });

  it("builds the `q` free-text OR group over 9 fields incl. labels text-cast (REEF-034)", () => {
    expect(buildIssueWhere(parse({ q: "auth", archived: true }))).toBe(
      `("reef_id" ILIKE '%auth%' ESCAPE '\\' OR ` +
        `"title" ILIKE '%auth%' ESCAPE '\\' OR ` +
        `"assigned_to" ILIKE '%auth%' ESCAPE '\\' OR ` +
        `"requester" ILIKE '%auth%' ESCAPE '\\' OR ` +
        `"reporter" ILIKE '%auth%' ESCAPE '\\' OR ` +
        `"milestone_id" ILIKE '%auth%' ESCAPE '\\' OR ` +
        `"sprint_id" ILIKE '%auth%' ESCAPE '\\' OR ` +
        `"release_id" ILIKE '%auth%' ESCAPE '\\' OR ` +
        `"labels"::text ILIKE '%auth%' ESCAPE '\\')`,
    );
  });

  it("AND-combines the `q` group with other facets (search narrows within filter) (REEF-034)", () => {
    const where = buildIssueWhere(parse({ status: ["todo"], q: "auth" }));
    // status facet, then the parenthesized q group, then the archived floor.
    expect(where).toBe(
      `"status" IN ('todo') AND ` +
        `("reef_id" ILIKE '%auth%' ESCAPE '\\' OR ` +
        `"title" ILIKE '%auth%' ESCAPE '\\' OR ` +
        `"assigned_to" ILIKE '%auth%' ESCAPE '\\' OR ` +
        `"requester" ILIKE '%auth%' ESCAPE '\\' OR ` +
        `"reporter" ILIKE '%auth%' ESCAPE '\\' OR ` +
        `"milestone_id" ILIKE '%auth%' ESCAPE '\\' OR ` +
        `"sprint_id" ILIKE '%auth%' ESCAPE '\\' OR ` +
        `"release_id" ILIKE '%auth%' ESCAPE '\\' OR ` +
        `"labels"::text ILIKE '%auth%' ESCAPE '\\') AND ` +
        `"archived_at" IS NULL`,
    );
  });

  it("AND-joins multiple facets with the archived floor", () => {
    expect(
      buildIssueWhere(parse({ status: ["todo"], priority: ["high"] })),
    ).toBe(
      `"status" IN ('todo') AND "priority" IN ('high') AND "archived_at" IS NULL`,
    );
  });

  it("renders due-date window bounds", () => {
    expect(
      buildIssueWhere(
        parse({
          due_after: "2026-01-01",
          due_before: "2026-03-31",
          archived: true,
        }),
      ),
    ).toBe(`"due_date" >= '2026-01-01' AND "due_date" <= '2026-03-31'`);
  });
});

describe("buildIssueOrderBy / priorityRankCase", () => {
  it("orders by the priority CASE rank with a reef_id tiebreaker", () => {
    expect(buildIssueOrderBy("priority", "desc")).toBe(
      `${priorityRankCase()} DESC, "reef_id" DESC`,
    );
  });

  it("orders by a plain column for non-priority fields", () => {
    expect(buildIssueOrderBy("created_at", "asc")).toBe(
      `"created_at" ASC, "reef_id" DESC`,
    );
  });

  it("maps direction to a literal ASC/DESC (no raw interpolation)", () => {
    expect(buildIssueOrderBy("due_date", "desc")).toBe(
      `COALESCE("due_date", '') DESC, "reef_id" DESC`,
    );
  });

  it("coalesces a NULL rank to the tail sentinel so unranked issues sink below ranked ones (REEF-129)", () => {
    expect(buildIssueOrderBy("rank", "asc")).toBe(
      `COALESCE("rank", 1000000000000000) ASC, "reef_id" DESC`,
    );
  });

  it("wraps the nullable estimate_points column in COALESCE (REEF-059)", () => {
    expect(buildIssueOrderBy("estimate_points", "desc")).toBe(
      `COALESCE("estimate_points", 0) DESC, "reef_id" DESC`,
    );
  });

  it("orders by a plain column for a title sort (REEF-059)", () => {
    expect(buildIssueOrderBy("title", "asc")).toBe(
      `"title" ASC, "reef_id" DESC`,
    );
  });
});

describe("keyset cursor", () => {
  it("round-trips encode/decode for a date sort", () => {
    const cursor = encodeCursor(
      { created_at: "2026-05-02T00:00:00.000Z", reef_id: "REEF-002" },
      "created_at",
    );
    expect(decodeCursor(cursor)).toEqual({
      k: "2026-05-02T00:00:00.000Z",
      id: "REEF-002",
    });
  });

  it("encodes the priority rank (not the raw priority) for a priority sort", () => {
    const cursor = encodeCursor(
      { priority: "high", reef_id: "REEF-002" },
      "priority",
    );
    expect(decodeCursor(cursor)).toEqual({ k: "3", id: "REEF-002" });
  });

  it("throws on a malformed cursor", () => {
    expect(() => decodeCursor("not-base64-json")).toThrow();
  });

  it("builds a descending keyset OR-chain with a reef_id tiebreaker", () => {
    expect(
      buildKeysetWhere("created_at", "desc", {
        k: "2026-05-02T00:00:00.000Z",
        id: "REEF-002",
      }),
    ).toBe(
      `(("created_at" < '2026-05-02T00:00:00.000Z') OR ("created_at" = '2026-05-02T00:00:00.000Z' AND "reef_id" < 'REEF-002'))`,
    );
  });

  it("uses the priority CASE rank as the keyset lead for a priority sort", () => {
    const where = buildKeysetWhere("priority", "desc", {
      k: "3",
      id: "REEF-002",
    });
    expect(where).toContain(`${priorityRankCase()} < 3`);
    expect(where).toContain(`"reef_id" < 'REEF-002'`);
  });

  it("parses a string-numeric rank when encoding the cursor", () => {
    const cursor = encodeCursor({ rank: "5", reef_id: "REEF-002" }, "rank");
    expect(decodeCursor(cursor)).toEqual({ k: "5", id: "REEF-002" });
  });

  it("encodes the tail sentinel as the cursor lead for an unranked (NULL) row (REEF-129)", () => {
    // A NULL rank should encode the same sentinel `sortLeadExpr` coalesces to, so a
    // keyset page boundary lands the unranked row in the tail, not at 0.
    const cursor = encodeCursor({ rank: null, reef_id: "REEF-002" }, "rank");
    expect(decodeCursor(cursor)).toEqual({
      k: "1000000000000000",
      id: "REEF-002",
    });
  });

  it("parses string-numeric estimate_points and compares numerically (REEF-059)", () => {
    // A string '13' should not collapse to 0, and the keyset should compare as a
    // number literal (13), not text ('13' < '9').
    const cursor = encodeCursor(
      { estimate_points: "13", reef_id: "REEF-002" },
      "estimate_points",
    );
    expect(decodeCursor(cursor)).toEqual({ k: "13", id: "REEF-002" });
    const where = buildKeysetWhere("estimate_points", "desc", {
      k: "13",
      id: "REEF-002",
    });
    expect(where).toContain(`COALESCE("estimate_points", 0) < 13`);
  });
});

describe("countIssuesByColumn", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps GROUP BY status rows to a status→count record", async () => {
    setupFetch([
      {
        body: {
          kind: "table_query",
          columns: ["status", "count"],
          items: [
            { status: "todo", count: 12 },
            { status: "in_progress", count: 3 },
          ],
          total: 2,
        },
      },
    ]);
    const counts = await countIssuesByColumn(makeTestAkbAdapter(), "reef-acme");
    expect(counts).toEqual({ todo: 12, in_progress: 3 });
  });

  it("returns {} for a never-onboarded vault (missing table)", async () => {
    setupFetch([
      {
        body: { error: 'relation "vt_reef-acme__reef_issues" does not exist' },
      },
    ]);
    const counts = await countIssuesByColumn(makeTestAkbAdapter(), "reef-acme");
    expect(counts).toEqual({});
  });
});
