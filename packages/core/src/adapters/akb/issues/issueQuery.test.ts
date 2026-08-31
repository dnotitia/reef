import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueListQuerySchema } from "../../../schemas/issues/requests";
import {
  makeTestAkbAdapter,
  setupFetch,
} from "../../../test-support/akb/fetchMock";
import {
  buildIssueOrderBy,
  buildIssueWhere,
  buildKeysetWhere,
  countIssuesByColumn,
  decodeCursor,
  encodeCursor,
  priorityRankCase,
} from "../core/shared";
import { SqlParameterBuilder } from "../core/sql";

const parse = (q: Record<string, unknown>) => IssueListQuerySchema.parse(q);
const ISSUE_NUMBER_SORT_EXPR = `CAST(SUBSTRING("reef_id" FROM '[0-9]+$') AS NUMERIC)`;

function issueWhere(q: Record<string, unknown>) {
  const params = new SqlParameterBuilder();
  return {
    sql: buildIssueWhere(parse(q), params),
    params: [...params.params],
  };
}

function keyset(
  field: Parameters<typeof buildIssueOrderBy>[0],
  order: Parameters<typeof buildIssueOrderBy>[1],
  cursor: { k: string; id: string },
) {
  const params = new SqlParameterBuilder();
  return {
    sql: buildKeysetWhere(field, order, cursor, params),
    params: [...params.params],
  };
}

describe("buildIssueWhere", () => {
  it("adds the archived_at IS NULL floor by default (no facets)", () => {
    expect(issueWhere({}).sql).toBe(`"archived_at" IS NULL`);
    expect(issueWhere({}).params).toEqual([]);
  });

  it("omits the archived floor when archived=true and no facets", () => {
    expect(issueWhere({ archived: true }).sql).toBeUndefined();
    expect(issueWhere({ archived: true }).params).toEqual([]);
  });

  it("renders a multi-value status IN list", () => {
    expect(
      issueWhere({ status: ["todo", "in_progress"], archived: true }).sql,
    ).toBe(`"status" IN ($1, $2)`);
    expect(
      issueWhere({ status: ["todo", "in_progress"], archived: true }).params,
    ).toEqual(["todo", "in_progress"]);
  });

  it("treats issue_type=task as matching NULL rows too", () => {
    expect(issueWhere({ issue_type: ["task"], archived: true }).sql).toBe(
      `("issue_type" = $1 OR "issue_type" IS NULL)`,
    );
    expect(issueWhere({ issue_type: ["task"], archived: true }).params).toEqual(
      ["task"],
    );
  });

  it("uses exact equality for a non-task issue_type", () => {
    expect(issueWhere({ issue_type: ["bug"], archived: true }).sql).toBe(
      `"issue_type" = $1`,
    );
    expect(issueWhere({ issue_type: ["bug"], archived: true }).params).toEqual([
      "bug",
    ]);
  });

  it("uses a case-insensitive exact IN for assigned_to (REEF-267, no longer substring)", () => {
    // Exact match, not the old `ILIKE '%ali%'` substring — so scoping to `ali`
    // does not incidentally return `alice` / `khalil`.
    expect(issueWhere({ assigned_to: ["ali"], archived: true }).sql).toBe(
      `LOWER("assigned_to") IN ($1)`,
    );
    expect(issueWhere({ assigned_to: ["ali"], archived: true }).params).toEqual(
      ["ali"],
    );
  });

  it("OR-combines a multi-value assigned_to facet and folds case (REEF-267)", () => {
    expect(
      issueWhere({ assigned_to: ["Alice", "BOB"], archived: true }).sql,
    ).toBe(`LOWER("assigned_to") IN ($1, $2)`);
    expect(
      issueWhere({ assigned_to: ["Alice", "BOB"], archived: true }).params,
    ).toEqual(["alice", "bob"]);
  });

  it("matches only unset priority values", () => {
    expect(issueWhere({ priority_unset: true, archived: true })).toEqual({
      sql: `"priority" IS NULL`,
      params: [],
    });
  });

  it("OR-combines a real priority with unset priority", () => {
    expect(
      issueWhere({ priority: ["high"], priority_unset: true, archived: true }),
    ).toEqual({
      sql: `("priority" IN ($1) OR "priority" IS NULL)`,
      params: ["high"],
    });
  });

  it("matches only unset severity values", () => {
    expect(issueWhere({ severity_unset: true, archived: true })).toEqual({
      sql: `"severity" IS NULL`,
      params: [],
    });
  });

  it("includes null, empty, and whitespace-only assignees in the unset set", () => {
    expect(issueWhere({ assigned_to_unset: true, archived: true })).toEqual({
      sql: `COALESCE(BTRIM("assigned_to"), '') = ''`,
      params: [],
    });
  });

  it("OR-combines a real assignee with the unset set without a username sentinel", () => {
    expect(
      issueWhere({
        assigned_to: ["__none__"],
        assigned_to_unset: true,
        archived: true,
      }),
    ).toEqual({
      sql: `(LOWER("assigned_to") IN ($1) OR COALESCE(BTRIM("assigned_to"), '') = '')`,
      params: ["__none__"],
    });
  });

  it("matches only issues without a due date", () => {
    expect(issueWhere({ due_unset: true, archived: true })).toEqual({
      sql: `"due_date" IS NULL`,
      params: [],
    });
  });

  it("uses a case-insensitive exact IN for requester (REEF-267)", () => {
    expect(
      issueWhere({ requester: ["carol", "dave"], archived: true }).sql,
    ).toBe(`LOWER("requester") IN ($1, $2)`);
    expect(
      issueWhere({ requester: ["carol", "dave"], archived: true }).params,
    ).toEqual(["carol", "dave"]);
  });

  it("renders a multi-value sprint_id IN list (REEF-267)", () => {
    expect(issueWhere({ sprint_id: ["s1", "s2"], archived: true }).sql).toBe(
      `"sprint_id" IN ($1, $2)`,
    );
    expect(
      issueWhere({ sprint_id: ["s1", "s2"], archived: true }).params,
    ).toEqual(["s1", "s2"]);
  });

  it("renders a multi-value release_id IN list (REEF-267)", () => {
    expect(issueWhere({ release_id: ["r1", "r2"], archived: true }).sql).toBe(
      `"release_id" IN ($1, $2)`,
    );
    expect(
      issueWhere({ release_id: ["r1", "r2"], archived: true }).params,
    ).toEqual(["r1", "r2"]);
  });

  it("keeps milestone_id a single exact match (multi-select out of scope, REEF-267)", () => {
    expect(issueWhere({ milestone_id: "m1", archived: true }).sql).toBe(
      `"milestone_id" = $1`,
    );
    expect(issueWhere({ milestone_id: "m1", archived: true }).params).toEqual([
      "m1",
    ]);
  });

  it("escapes LIKE metacharacters in the value", () => {
    const result = issueWhere({ q: "50%_x", archived: true });
    expect(result.sql).toContain(`ILIKE $1 ESCAPE '\\'`);
    expect(result.params).toEqual(["%50\\%\\_x%"]);
  });

  it("escapes a literal backslash in the value (ESCAPE-clause safety)", () => {
    const result = issueWhere({ q: "a\\b", archived: true });
    expect(result.sql).toContain(`ILIKE $1 ESCAPE '\\'`);
    expect(result.params).toEqual(["%a\\\\b%"]);
  });

  it("escapes single quotes (injection-safe)", () => {
    const result = issueWhere({ sprint_id: ["a'b"], archived: true });
    expect(result.sql).toBe(`"sprint_id" IN ($1)`);
    expect(result.params).toEqual(["a'b"]);
  });

  it("builds the `q` free-text OR group over 9 fields incl. labels text-cast (REEF-034)", () => {
    expect(issueWhere({ q: "auth", archived: true }).sql).toBe(
      `("reef_id" ILIKE $1 ESCAPE '\\' OR ` +
        `"title" ILIKE $1 ESCAPE '\\' OR ` +
        `"assigned_to" ILIKE $1 ESCAPE '\\' OR ` +
        `"requester" ILIKE $1 ESCAPE '\\' OR ` +
        `"reporter" ILIKE $1 ESCAPE '\\' OR ` +
        `"milestone_id" ILIKE $1 ESCAPE '\\' OR ` +
        `"sprint_id" ILIKE $1 ESCAPE '\\' OR ` +
        `"release_id" ILIKE $1 ESCAPE '\\' OR ` +
        `"labels"::text ILIKE $1 ESCAPE '\\')`,
    );
    expect(issueWhere({ q: "auth", archived: true }).params).toEqual([
      "%auth%",
    ]);
  });

  it("AND-combines the `q` group with other facets (search narrows within filter) (REEF-034)", () => {
    const result = issueWhere({ status: ["todo"], q: "auth" });
    // status facet, then the parenthesized q group, then the archived floor.
    expect(result.sql).toBe(
      `"status" IN ($1) AND ` +
        `("reef_id" ILIKE $2 ESCAPE '\\' OR ` +
        `"title" ILIKE $2 ESCAPE '\\' OR ` +
        `"assigned_to" ILIKE $2 ESCAPE '\\' OR ` +
        `"requester" ILIKE $2 ESCAPE '\\' OR ` +
        `"reporter" ILIKE $2 ESCAPE '\\' OR ` +
        `"milestone_id" ILIKE $2 ESCAPE '\\' OR ` +
        `"sprint_id" ILIKE $2 ESCAPE '\\' OR ` +
        `"release_id" ILIKE $2 ESCAPE '\\' OR ` +
        `"labels"::text ILIKE $2 ESCAPE '\\') AND ` +
        `"archived_at" IS NULL`,
    );
    expect(result.params).toEqual(["todo", "%auth%"]);
  });

  it("AND-joins multiple facets with the archived floor", () => {
    expect(issueWhere({ status: ["todo"], priority: ["high"] }).sql).toBe(
      `"status" IN ($1) AND "priority" IN ($2) AND "archived_at" IS NULL`,
    );
    expect(issueWhere({ status: ["todo"], priority: ["high"] }).params).toEqual(
      ["todo", "high"],
    );
  });

  it("binds every facet value and keeps special free-text data out of SQL", () => {
    const result = issueWhere({
      status: ["todo"],
      priority: ["high"],
      severity: ["major"],
      issue_type: ["bug"],
      assigned_to: ["Alice"],
      requester: ["김영로"],
      sprint_id: ["sprint'\\😀"],
      milestone_id: "milestone",
      release_id: ["release"],
      due_after: "2026-01-01",
      due_before: "2026-03-31",
      q: "it's 한글😀",
      archived: true,
    });

    expect(result.sql).toContain('"status" IN ($1)');
    expect(result.sql).toContain('"priority" IN ($2)');
    expect(result.sql).toContain('"severity" IN ($3)');
    expect(result.sql).toContain('"issue_type" = $4');
    expect(result.sql).toContain('LOWER("assigned_to") IN ($5)');
    expect(result.sql).toContain('LOWER("requester") IN ($6)');
    expect(result.sql).toContain('"sprint_id" IN ($7)');
    expect(result.sql).toContain('"milestone_id" = $8');
    expect(result.sql).toContain('"release_id" IN ($9)');
    expect(result.sql).toContain('"due_date" >= $10');
    expect(result.sql).toContain('"due_date" <= $11');
    expect(result.sql).toContain("ILIKE $12 ESCAPE");
    expect(result.sql).not.toContain("it's");
    expect(result.params).toEqual([
      "todo",
      "high",
      "major",
      "bug",
      "alice",
      "김영로",
      "sprint'\\😀",
      "milestone",
      "release",
      "2026-01-01",
      "2026-03-31",
      "%it's 한글😀%",
    ]);
  });

  it("renders due-date window bounds", () => {
    expect(
      issueWhere({
        due_after: "2026-01-01",
        due_before: "2026-03-31",
        archived: true,
      }).sql,
    ).toBe(`"due_date" >= $1 AND "due_date" <= $2`);
    expect(
      issueWhere({
        due_after: "2026-01-01",
        due_before: "2026-03-31",
        archived: true,
      }).params,
    ).toEqual(["2026-01-01", "2026-03-31"]);
  });
});

describe("buildIssueOrderBy / priorityRankCase", () => {
  it("orders by the priority CASE rank with a numeric issue-number tiebreaker", () => {
    expect(buildIssueOrderBy("priority", "desc")).toBe(
      `${priorityRankCase()} DESC, ${ISSUE_NUMBER_SORT_EXPR} DESC`,
    );
  });

  it("orders by a plain column for non-priority fields", () => {
    expect(buildIssueOrderBy("created_at", "asc")).toBe(
      `"created_at" ASC, ${ISSUE_NUMBER_SORT_EXPR} DESC`,
    );
  });

  it.each(["start_date", "due_date"] as const)(
    "puts missing %s values in the tail for both directions",
    (field) => {
      expect(buildIssueOrderBy(field, "asc")).toBe(
        `CASE WHEN "${field}" IS NULL THEN 1 ELSE 0 END ASC, COALESCE("${field}", '') ASC, ${ISSUE_NUMBER_SORT_EXPR} DESC`,
      );
      expect(buildIssueOrderBy(field, "desc")).toBe(
        `CASE WHEN "${field}" IS NULL THEN 1 ELSE 0 END ASC, COALESCE("${field}", '') DESC, ${ISSUE_NUMBER_SORT_EXPR} DESC`,
      );
    },
  );

  it("coalesces a NULL rank to the tail sentinel so unranked issues sink below ranked ones (REEF-129)", () => {
    expect(buildIssueOrderBy("rank", "asc")).toBe(
      `COALESCE("rank", 1000000000000000) ASC, ${ISSUE_NUMBER_SORT_EXPR} DESC`,
    );
  });

  it("wraps the nullable estimate_points column in COALESCE (REEF-059)", () => {
    expect(buildIssueOrderBy("estimate_points", "desc")).toBe(
      `COALESCE("estimate_points", 0) DESC, ${ISSUE_NUMBER_SORT_EXPR} DESC`,
    );
  });

  it("uses the canonical ICU collation for a title sort", () => {
    expect(buildIssueOrderBy("title", "asc")).toBe(
      `"title" COLLATE "und-x-icu" ASC, ${ISSUE_NUMBER_SORT_EXPR} DESC`,
    );
  });

  it("sorts ticket numbers numerically without assuming prefix or padding", () => {
    expect(buildIssueOrderBy("reef_id", "asc")).toBe(
      `${ISSUE_NUMBER_SORT_EXPR} ASC`,
    );
    expect(buildIssueOrderBy("reef_id", "desc")).toBe(
      `${ISSUE_NUMBER_SORT_EXPR} DESC`,
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

  it("builds a descending keyset OR-chain with a numeric issue-number tiebreaker", () => {
    const result = keyset("created_at", "desc", {
      k: "2026-05-02T00:00:00.000Z",
      id: "REEF-002",
    });
    expect(result.sql).toBe(
      `(("created_at" < $1) OR ("created_at" = $1 AND ${ISSUE_NUMBER_SORT_EXPR} < $2))`,
    );
    expect(result.params).toEqual(["2026-05-02T00:00:00.000Z", 2]);
  });

  it("uses the priority CASE rank as the keyset lead for a priority sort", () => {
    const result = keyset("priority", "desc", {
      k: "3",
      id: "REEF-002",
    });
    expect(result.sql).toContain(`${priorityRankCase()} < $1`);
    expect(result.sql).toContain(`${ISSUE_NUMBER_SORT_EXPR} < $2`);
    expect(result.params).toEqual([3, 2]);
  });

  it("uses the same ICU title expression for the keyset predicate", () => {
    const result = keyset("title", "desc", {
      k: "Alpha",
      id: "REEF-002",
    });
    expect(result.sql).toBe(
      `(("title" COLLATE "und-x-icu" < $1) OR ("title" COLLATE "und-x-icu" = $1 AND ${ISSUE_NUMBER_SORT_EXPR} < $2))`,
    );
    expect(result.params).toEqual(["Alpha", 2]);
  });

  it("uses the numeric ticket key for the 999/1000 cursor boundary", () => {
    const cursor = encodeCursor({ reef_id: "TEAM_2-999" }, "reef_id");
    expect(decodeCursor(cursor)).toEqual({ k: "999", id: "TEAM_2-999" });

    const result = keyset("reef_id", "asc", {
      k: "999",
      id: "TEAM_2-999",
    });
    expect(result.sql).toBe(`(${ISSUE_NUMBER_SORT_EXPR} > $1)`);
    expect(result.params).toEqual([999]);
  });

  it("uses the canonical numeric tie-breaker for a 1000 cursor", () => {
    const result = keyset("created_at", "desc", {
      k: "2026-05-02T00:00:00.000Z",
      id: "TEAM_2-1000",
    });
    expect(result.sql).toContain(`${ISSUE_NUMBER_SORT_EXPR} < $2`);
    expect(result.sql).not.toContain('"reef_id" <');
    expect(result.params).toEqual(["2026-05-02T00:00:00.000Z", 1000]);
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
    const result = keyset("estimate_points", "desc", {
      k: "13",
      id: "REEF-002",
    });
    expect(result.sql).toContain(`COALESCE("estimate_points", 0) < $1`);
    expect(result.params).toEqual([13, 2]);
  });

  it.each(["start_date", "due_date"] as const)(
    "keeps the date null bucket in the keyset predicate for %s",
    (field) => {
      const result = keyset(field, "asc", {
        k: "2026-06-01",
        id: "REEF-010",
      });
      expect(result.sql).toContain(
        `CASE WHEN "${field}" IS NULL THEN 1 ELSE 0 END > $1`,
      );
      expect(result.sql).toContain(
        `CASE WHEN "${field}" IS NULL THEN 1 ELSE 0 END = $1`,
      );
      expect(result.sql).toContain(`COALESCE("${field}", '') > $2`);
      expect(result.sql).toContain(`${ISSUE_NUMBER_SORT_EXPR} < $3`);
      expect(result.params).toEqual([0, "2026-06-01", 10]);
    },
  );

  it("encodes an undated cursor at the null-tail boundary", () => {
    const cursor = encodeCursor(
      { due_date: null, reef_id: "REEF-101" },
      "due_date",
    );
    expect(decodeCursor(cursor)).toEqual({ k: "", id: "REEF-101" });

    const result = keyset("due_date", "desc", {
      k: "",
      id: "REEF-101",
    });
    expect(result.sql).toContain(
      `CASE WHEN "due_date" IS NULL THEN 1 ELSE 0 END > $1`,
    );
    expect(result.sql).toContain(`COALESCE("due_date", '') = $2`);
    expect(result.sql).toContain(`${ISSUE_NUMBER_SORT_EXPR} < $3`);
    expect(result.params).toEqual([1, "", 101]);
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
