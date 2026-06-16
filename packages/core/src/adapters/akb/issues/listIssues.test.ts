import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeIssueQueryResponse,
  makeTestAkbAdapter,
  setupFetch,
} from "../../../agents/tools/__test-helpers__/fetchMock";
import { mockOpenTelemetry } from "../../../agents/tools/__test-helpers__/otelMock";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import { IssueListQuerySchema } from "../../../schemas/issues/requests";
import { encodeCursor } from "../core/shared";
import { listIssueRelations, listIssues } from "./issues";

mockOpenTelemetry();

function capturedSql(calls: { init: RequestInit | undefined }[]): string {
  const body = calls[0]?.init?.body;
  return JSON.parse(String(body)).sql as string;
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
    expect(sql).toContain(`WHERE "status" IN ('todo', 'in_progress')`);
    expect(sql).toContain(`AND "archived_at" IS NULL`);
    expect(sql).toContain(
      `ORDER BY COALESCE("due_date", '') ASC, "reef_id" DESC`,
    );
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
    expect(capturedSql(calls)).toContain("LIMIT 3");
    expect(res.issues).toHaveLength(2);
    expect(res.next_cursor).toBeTruthy();
  });

  it("returns next_cursor null when there is no next page", async () => {
    setupFetch([
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
    expect(sql).toContain(`"created_at" < '2026-05-02T00:00:00.000Z'`);
    expect(sql).toContain(`"reef_id" < 'REEF-002'`);
  });
});

describe("listIssueRelations", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("projects reef_id/status/depends_on into relation nodes", async () => {
    const { calls } = setupFetch([
      {
        body: {
          kind: "table_query",
          columns: ["reef_id", "status", "depends_on"],
          items: [
            { reef_id: "REEF-001", status: "todo", depends_on: ["REEF-002"] },
            { reef_id: "REEF-002", status: "done", depends_on: [] },
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
      `SELECT "reef_id", "status", "depends_on" FROM reef_issues`,
    );
    expect(relations).toEqual([
      { id: "REEF-001", status: "todo", depends_on: ["REEF-002"] },
      { id: "REEF-002", status: "done", depends_on: [] },
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
