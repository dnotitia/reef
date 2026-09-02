import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import { IssueListQuerySchema } from "../../../schemas/issues/requests";
import {
  makeIssueQueryResponse,
  makeTestAkbAdapter,
  setupFetch,
} from "../../../test-support/akb/fetchMock";
import { mockOpenTelemetry } from "../../../test-support/akb/otelMock";
import { decodeCursor, encodeCursor } from "../core/shared";
import { listIssueRelations, listIssues } from "./issues";

mockOpenTelemetry();

function capturedSql(calls: { init: RequestInit | undefined }[]): string {
  const body = calls[0]?.init?.body;
  return JSON.parse(String(body)).sql as string;
}

function capturedParams(calls: { init: RequestInit | undefined }[]): unknown[] {
  const body = calls[0]?.init?.body;
  return (JSON.parse(String(body)).params as unknown[] | undefined) ?? [];
}

describe("listIssues → SQL", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("issues a bare SELECT * with no WHERE/ORDER when unfiltered", async () => {
    const { calls } = setupFetch([{ body: makeIssueQueryResponse([]) }]);
    const res = await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
    });
    expect(res.issues).toEqual([]);
    expect(capturedSql(calls)).toBe("SELECT * FROM reef_issues");
  });

  it("translates a query to a server-side WHERE + ORDER BY", async () => {
    const { calls } = setupFetch([{ body: makeIssueQueryResponse([]) }]);
    const query = IssueListQuerySchema.parse({
      status: ["todo", "in_progress"],
      sort_field: "due_date",
      sort_order: "asc",
    });
    await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query,
    });
    const sql = capturedSql(calls);
    expect(sql).toContain(`WHERE "status" IN ($1, $2)`);
    expect(sql).toContain(`AND "archived_at" IS NULL`);
    expect(sql).toContain(
      `ORDER BY CASE WHEN "due_date" IS NULL THEN 1 ELSE 0 END ASC, COALESCE("due_date", '') ASC, CAST(SUBSTRING("reef_id" FROM '[0-9]+$') AS NUMERIC) DESC`,
    );
    expect(capturedParams(calls)).toEqual(["todo", "in_progress"]);
  });

  it("emits no ORDER BY for a filtered query without an explicit sort", async () => {
    const { calls } = setupFetch([{ body: makeIssueQueryResponse([]) }]);
    const query = IssueListQuerySchema.parse({ status: ["todo"] });
    await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query,
    });
    expect(capturedSql(calls)).not.toContain("ORDER BY");
    expect(capturedParams(calls)).toEqual(["todo"]);
  });

  it("pushes the date-range predicate into the paginated server query", async () => {
    const { calls } = setupFetch([{ body: makeIssueQueryResponse([]) }]);
    await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query: IssueListQuerySchema.parse({
        date_range: {
          field: "updated_at",
          from: "2026-06-01T07:00:00.000Z",
          to: "2026-06-03T07:00:00.000Z",
        },
        archived: true,
        limit: 2,
      }),
    });
    expect(capturedSql(calls)).toContain(
      `WHERE "updated_at" >= $1 AND "updated_at" < $2`,
    );
    expect(capturedSql(calls)).toContain("LIMIT $3");
    expect(capturedParams(calls)).toEqual([
      "2026-06-01T07:00:00.000Z",
      "2026-06-03T07:00:00.000Z",
      3,
    ]);
  });

  it("pushes a nullable date-only range into the paginated server query", async () => {
    const { calls } = setupFetch([{ body: makeIssueQueryResponse([]) }]);
    await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query: IssueListQuerySchema.parse({
        date_range: {
          field: "due_date",
          from: "2026-06-01",
          to: "2026-06-03",
        },
        archived: true,
        limit: 2,
      }),
    });
    expect(capturedSql(calls)).toContain(
      `WHERE "due_date" IS NOT NULL AND "due_date" >= $1 AND "due_date" < $2`,
    );
    expect(capturedParams(calls)).toEqual(["2026-06-01", "2026-06-03", 3]);
  });
});

function makeIssue(over: Partial<IssueMetadata>): IssueMetadata {
  return {
    id: "REEF-001",
    title: "Issue",
    status: "todo",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
    ...over,
  };
}

describe("listIssues pagination", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a mixed-title cursor boundary stable past 100 rows", async () => {
    const titles = [
      ...Array.from(
        { length: 34 },
        (_, index) => `! Symbol ${String(index).padStart(3, "0")}`,
      ),
      ...Array.from(
        { length: 34 },
        (_, index) => `Alpha ${String(index).padStart(3, "0")}`,
      ),
      ...Array.from(
        { length: 33 },
        (_, index) => `가나다 ${String(index).padStart(3, "0")}`,
      ),
    ];
    const rows = titles.map((title, index) =>
      makeIssue({
        id: `REEF-${String(index + 1).padStart(3, "0")}`,
        title,
      }),
    );

    const firstFetch = setupFetch([{ body: makeIssueQueryResponse(rows) }]);
    const firstPage = await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query: IssueListQuerySchema.parse({
        sort_field: "title",
        sort_order: "asc",
        limit: 100,
      }),
    });

    expect(firstPage.issues).toHaveLength(100);
    expect(firstPage.issues.map((issue) => issue.id)).toEqual(
      rows.slice(0, 100).map((row) => row.id),
    );
    expect(firstPage.next_cursor).toBeTruthy();
    expect(capturedSql(firstFetch.calls)).toContain(
      `ORDER BY "title" COLLATE "und-x-icu" ASC, CAST(SUBSTRING("reef_id" FROM '[0-9]+$') AS NUMERIC) DESC`,
    );
    expect(capturedSql(firstFetch.calls)).toContain("LIMIT $1");
    expect(capturedParams(firstFetch.calls)).toEqual([101]);
    expect(decodeCursor(firstPage.next_cursor ?? "")).toEqual({
      k: rows[99]?.title,
      id: rows[99]?.id,
    });

    const secondFetch = setupFetch([
      { body: makeIssueQueryResponse(rows.slice(100)) },
    ]);
    const secondPage = await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query: IssueListQuerySchema.parse({
        sort_field: "title",
        sort_order: "asc",
        limit: 100,
        cursor: firstPage.next_cursor,
      }),
    });

    const combinedIds = [
      ...firstPage.issues.map((issue) => issue.id),
      ...secondPage.issues.map((issue) => issue.id),
    ];
    expect(combinedIds).toEqual(rows.map((row) => row.id));
    expect(new Set(combinedIds).size).toBe(101);
    expect(capturedSql(secondFetch.calls)).toContain(
      `"title" COLLATE "und-x-icu" > $1`,
    );
    expect(capturedParams(secondFetch.calls)).toEqual(["가나다 031", 100, 101]);
  });

  it("fetches limit+1 and returns next_cursor when a full extra row exists", async () => {
    const rows = [
      makeIssue({ id: "REEF-003", created_at: "2026-05-03T00:00:00.000Z" }),
      makeIssue({ id: "REEF-002", created_at: "2026-05-02T00:00:00.000Z" }),
      makeIssue({ id: "REEF-001", created_at: "2026-05-01T00:00:00.000Z" }),
    ];
    const { calls } = setupFetch([{ body: makeIssueQueryResponse(rows) }]);
    const query = IssueListQuerySchema.parse({
      sort_field: "created_at",
      limit: 2,
    });
    const res = await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query,
    });
    expect(capturedSql(calls)).toContain("LIMIT $1");
    expect(capturedParams(calls)).toEqual([3]);
    expect(res.issues).toHaveLength(2);
    expect(res.next_cursor).toBeTruthy();
  });

  it("returns next_cursor null when there is no next page", async () => {
    const { calls } = setupFetch([
      { body: makeIssueQueryResponse([makeIssue({ id: "REEF-001" })]) },
    ]);
    const query = IssueListQuerySchema.parse({ limit: 50 });
    const res = await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query,
    });
    expect(res.next_cursor).toBeNull();
    expect(res.issues).toHaveLength(1);
    expect(capturedParams(calls)).toEqual([51]);
  });

  it("applies the keyset predicate when a cursor is supplied", async () => {
    const cursor = encodeCursor(
      { created_at: "2026-05-02T00:00:00.000Z", reef_id: "REEF-002" },
      "created_at",
    );
    const { calls } = setupFetch([{ body: makeIssueQueryResponse([]) }]);
    const query = IssueListQuerySchema.parse({
      sort_field: "created_at",
      limit: 2,
      cursor,
    });
    await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query,
    });
    const sql = capturedSql(calls);
    expect(sql).toContain(`"created_at" < $1`);
    expect(sql).toContain(
      `CAST(SUBSTRING("reef_id" FROM '[0-9]+$') AS NUMERIC) < $2`,
    );
    expect(capturedParams(calls)).toEqual(["2026-05-02T00:00:00.000Z", 2, 3]);
  });

  it("keeps a numeric ticket-number keyset page boundary past 100 rows", async () => {
    const rows = [
      ...Array.from({ length: 98 }, (_, index) =>
        makeIssue({ id: `TEAM_2-${index + 1}` }),
      ),
      makeIssue({ id: "TEAM_2-999" }),
      makeIssue({ id: "TEAM_2-1000" }),
      makeIssue({ id: "TEAM_2-1002" }),
    ];
    const firstFetch = setupFetch([{ body: makeIssueQueryResponse(rows) }]);
    const firstPage = await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query: IssueListQuerySchema.parse({
        sort_field: "reef_id",
        sort_order: "asc",
        limit: 100,
      }),
    });

    expect(firstPage.issues.map((issue) => issue.id)).toEqual(
      rows.slice(0, 100).map((row) => row.id),
    );
    expect(decodeCursor(firstPage.next_cursor ?? "")).toEqual({
      k: "1000",
      id: "TEAM_2-1000",
    });
    expect(capturedSql(firstFetch.calls)).toContain(
      `ORDER BY CAST(SUBSTRING("reef_id" FROM '[0-9]+$') AS NUMERIC) ASC LIMIT $1`,
    );
    expect(capturedSql(firstFetch.calls)).toContain("LIMIT $1");
    expect(capturedParams(firstFetch.calls)).toEqual([101]);

    const secondFetch = setupFetch([
      { body: makeIssueQueryResponse(rows.slice(100)) },
    ]);
    const secondPage = await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query: IssueListQuerySchema.parse({
        sort_field: "reef_id",
        sort_order: "asc",
        limit: 100,
        cursor: firstPage.next_cursor,
      }),
    });

    expect([
      ...firstPage.issues.map((issue) => issue.id),
      ...secondPage.issues.map((issue) => issue.id),
    ]).toEqual(rows.map((row) => row.id));
    expect(capturedSql(secondFetch.calls)).toContain(
      `CAST(SUBSTRING("reef_id" FROM '[0-9]+$') AS NUMERIC) > $1`,
    );
    expect(capturedSql(secondFetch.calls)).not.toContain('"reef_id" <');
    expect(capturedParams(secondFetch.calls)).toEqual([1000, 101]);
  });

  it.each([
    { field: "start_date" as const, order: "asc" as const },
    { field: "start_date" as const, order: "desc" as const },
    { field: "due_date" as const, order: "asc" as const },
    { field: "due_date" as const, order: "desc" as const },
  ])(
    "passes a mixed date/null page boundary without losing rows ($field $order)",
    async ({ field, order }) => {
      const dated = Array.from({ length: 99 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 0, index + 1))
          .toISOString()
          .slice(0, 10);
        const row: Partial<IssueMetadata> = {
          id: `REEF-${String(index + 1).padStart(3, "0")}`,
        };
        row[field] = date;
        return makeIssue(row);
      });
      const ordered = order === "asc" ? dated : [...dated].reverse();
      const undated = [100, 101, 102].map((index) => {
        const row: Partial<IssueMetadata> = {
          id: `REEF-${index}`,
        };
        row[field] = null;
        return makeIssue(row);
      });
      const rows = [...ordered, ...undated];

      const firstFetch = setupFetch([{ body: makeIssueQueryResponse(rows) }]);
      const firstPage = await listIssues({
        adapter: makeTestAkbAdapter(),
        vault: "reef-acme",
        query: IssueListQuerySchema.parse({
          sort_field: field,
          sort_order: order,
          limit: 100,
        }),
      });

      expect(firstPage.issues.map((issue) => issue.id)).toEqual(
        rows.slice(0, 100).map((row) => row.id),
      );
      expect(decodeCursor(firstPage.next_cursor ?? "")).toEqual({
        k: "",
        id: rows[99]?.id,
      });

      const secondFetch = setupFetch([
        { body: makeIssueQueryResponse(rows.slice(100)) },
      ]);
      const secondPage = await listIssues({
        adapter: makeTestAkbAdapter(),
        vault: "reef-acme",
        query: IssueListQuerySchema.parse({
          sort_field: field,
          sort_order: order,
          limit: 100,
          cursor: firstPage.next_cursor,
        }),
      });

      const combined = [
        ...firstPage.issues.map((issue) => issue.id),
        ...secondPage.issues.map((issue) => issue.id),
      ];
      expect(combined).toEqual(rows.map((row) => row.id));
      expect(capturedSql(secondFetch.calls)).toContain(
        `CASE WHEN "${field}" IS NULL THEN 1 ELSE 0 END > $1`,
      );
      expect(capturedSql(firstFetch.calls)).toContain(
        `ORDER BY CASE WHEN "${field}" IS NULL THEN 1 ELSE 0 END ASC, COALESCE("${field}", '') ${order.toUpperCase()}, CAST(SUBSTRING("reef_id" FROM '[0-9]+$') AS NUMERIC) DESC LIMIT $1`,
      );
      expect(capturedParams(firstFetch.calls)).toEqual([101]);
      expect(capturedParams(secondFetch.calls)).toEqual([1, "", 100, 101]);
    },
  );
});

describe("listIssueRelations", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("projects hierarchy metadata and dependencies into relation nodes", async () => {
    const { calls } = setupFetch([
      {
        body: {
          kind: "table_query",
          columns: [
            "reef_id",
            "status",
            "depends_on",
            "issue_type",
            "parent_id",
            "title",
            "rank",
          ],
          items: [
            {
              reef_id: "REEF-001",
              status: "todo",
              depends_on: ["REEF-002"],
              issue_type: "story",
              parent_id: "REEF-100",
              title: "Child",
              rank: 2,
            },
            {
              reef_id: "REEF-002",
              status: "done",
              depends_on: [],
              issue_type: "epic",
              parent_id: null,
              title: "Epic",
              rank: 1,
            },
          ],
          total: 2,
        },
      },
    ]);
    const relations = await listIssueRelations(
      makeTestAkbAdapter(),
      "reef-acme",
    );
    expect(capturedSql(calls)).toBe(
      `SELECT "reef_id", "status", "depends_on", "issue_type", "parent_id", "title", "rank" FROM reef_issues`,
    );
    expect(relations).toEqual([
      {
        id: "REEF-001",
        status: "todo",
        depends_on: ["REEF-002"],
        issue_type: "story",
        parent_id: "REEF-100",
        title: "Child",
        rank: 2,
      },
      {
        id: "REEF-002",
        status: "done",
        depends_on: [],
        issue_type: "epic",
        parent_id: null,
        title: "Epic",
        rank: 1,
      },
    ]);
  });

  it("returns [] for a never-onboarded vault (missing table)", async () => {
    setupFetch([
      {
        body: { error: 'relation "vt_reef-acme__reef_issues" does not exist' },
      },
    ]);
    const relations = await listIssueRelations(
      makeTestAkbAdapter(),
      "reef-acme",
    );
    expect(relations).toEqual([]);
  });
});
