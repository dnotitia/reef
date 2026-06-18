import { describe, expect, it } from "vitest";
import {
  ALL_REEF_TABLES,
  REEF_ACTIVITY_TABLE,
  appendStatusChangeEvent,
  listIssueActivity,
  makeAdapter,
  makeListTablesResponse,
  makeSqlMutationResponse,
  makeSqlQueryResponse,
  makeSqlRuntimeErrorResponse,
  setupFetch,
  statusChangeEventKey,
} from "./akb.testSupport";

// REEF-063: the immutable ISSUE activity log (reef_activity), distinct from the
// GitHub activity-scan inbox (reef_activity_suggestions) tested in
// akb.activity.test.ts.

const ACTIVITY_ROW_COLUMNS = [
  "id",
  "reef_id",
  "event_type",
  "event_key",
  "payload",
  "meta",
  "created_at",
  "updated_at",
  "created_by",
];

function makeActivityRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    reef_id: "REEF-063",
    event_type: "status_change",
    event_key: "status_change:todo->in_progress@2026-06-18T01:00:00.000Z",
    payload: { from: "todo", to: "in_progress" },
    meta: {
      actor: "alice",
      at: "2026-06-18T01:00:00.000Z",
      source: "ai-agent:user_request",
    },
    created_at: "2026-06-18T01:00:00.123456+00",
    updated_at: "2026-06-18T01:00:00.123456+00",
    created_by: "akb-principal",
    ...overrides,
  };
}

function lastSql(body: unknown): string {
  return JSON.parse(body as string).sql as string;
}

describe("statusChangeEventKey", () => {
  it("is a deterministic from→to@timestamp key", () => {
    expect(
      statusChangeEventKey("todo", "in_progress", "2026-06-18T01:00:00.000Z"),
    ).toBe("status_change:todo->in_progress@2026-06-18T01:00:00.000Z");
  });
});

describe("appendStatusChangeEvent", () => {
  it("provisions, probes idempotency, then inserts only declared columns", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) }, // ensureReefTables
      { body: makeSqlQueryResponse([], ["id"]) }, // idempotency probe: no row yet
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT event
    ]);

    await appendStatusChangeEvent(makeAdapter(), "reef-sample", {
      reefId: "REEF-063",
      from: "todo",
      to: "in_progress",
      at: "2026-06-18T01:00:00.000Z",
      actor: "alice",
      source: "ai-agent:user_request",
    });

    expect(calls).toHaveLength(3);

    const probeSql = lastSql(calls[1]?.init?.body);
    expect(probeSql).toContain(`SELECT id FROM ${REEF_ACTIVITY_TABLE}`);
    expect(probeSql).toContain("reef_id = 'REEF-063'");
    expect(probeSql).toContain(
      "event_key = 'status_change:todo->in_progress@2026-06-18T01:00:00.000Z'",
    );

    const insertSql = lastSql(calls[2]?.init?.body);
    expect(insertSql).toContain(`INSERT INTO ${REEF_ACTIVITY_TABLE}`);
    // Only declared columns — never the akb reserved/auto columns.
    expect(insertSql).toContain(
      `("reef_id", "event_type", "event_key", "payload", "meta")`,
    );
    expect(insertSql).not.toContain("created_by");
    expect(insertSql).toContain("'status_change'");
    expect(insertSql).toContain('"from":"todo"');
    expect(insertSql).toContain('"to":"in_progress"');
    // Semantic actor / event time / provenance live in meta.
    expect(insertSql).toContain('"actor":"alice"');
    expect(insertSql).toContain('"at":"2026-06-18T01:00:00.000Z"');
    expect(insertSql).toContain('"source":"ai-agent:user_request"');
  });

  it("is idempotent: an existing event_key skips the insert", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) }, // ensureReefTables
      { body: makeSqlQueryResponse([{ id: "existing-uuid" }], ["id"]) }, // probe: row already present
    ]);

    await appendStatusChangeEvent(makeAdapter(), "reef-sample", {
      reefId: "REEF-063",
      from: "todo",
      to: "in_progress",
      at: "2026-06-18T01:00:00.000Z",
      actor: "alice",
    });

    // No third call — the INSERT is skipped because the event already exists.
    expect(calls).toHaveLength(2);
  });

  it("defaults meta.source to null when no provenance is given", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([], ["id"]) },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);

    await appendStatusChangeEvent(makeAdapter(), "reef-sample", {
      reefId: "REEF-063",
      from: "in_progress",
      to: "in_review",
      at: "2026-06-18T02:00:00.000Z",
      actor: "bob",
    });

    const insertSql = lastSql(calls[2]?.init?.body);
    expect(insertSql).toContain('"source":null');
  });
});

describe("listIssueActivity", () => {
  it("projects payload/actor/at/source from the row and orders oldest-first", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            makeActivityRow({
              id: "e1",
              event_key:
                "status_change:todo->in_progress@2026-06-18T01:00:00.000Z",
              payload: { from: "todo", to: "in_progress" },
              meta: {
                actor: "alice",
                at: "2026-06-18T01:00:00.000Z",
                source: "ai-agent:user_request",
              },
            }),
            makeActivityRow({
              id: "e2",
              event_key:
                "status_change:in_progress->in_review@2026-06-18T02:00:00.000Z",
              payload: { from: "in_progress", to: "in_review" },
              meta: {
                actor: "bob",
                at: "2026-06-18T02:00:00.000Z",
                source: null,
              },
            }),
          ],
          ACTIVITY_ROW_COLUMNS,
        ),
      },
    ]);

    const events = await listIssueActivity(
      makeAdapter(),
      "reef-sample",
      "REEF-063",
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      id: "e1",
      event_type: "status_change",
      payload: { from: "todo", to: "in_progress" },
      actor: "alice",
      at: "2026-06-18T01:00:00.000Z",
      source: "ai-agent:user_request",
    });
    expect(events[1]).toMatchObject({
      payload: { from: "in_progress", to: "in_review" },
      actor: "bob",
      source: null,
    });

    const sql = lastSql(calls[0]?.init?.body);
    expect(sql).toContain(`FROM ${REEF_ACTIVITY_TABLE}`);
    expect(sql).toContain("reef_id = 'REEF-063'");
    expect(sql).toContain("ORDER BY meta->>'at' ASC, id ASC");
  });

  it("returns an empty history for an unprovisioned vault (no reconcile)", async () => {
    const { calls } = setupFetch([
      makeSqlRuntimeErrorResponse(REEF_ACTIVITY_TABLE),
    ]);

    const events = await listIssueActivity(
      makeAdapter(),
      "reef-sample",
      "REEF-063",
    );

    expect(events).toEqual([]);
    // Read path absorbs the missing table without a follow-up provisioning call.
    expect(calls).toHaveLength(1);
  });

  it("skips a malformed row rather than failing the whole history", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            makeActivityRow({ id: "e1" }),
            // missing meta.actor → fails ActivityEventMetaSchema
            makeActivityRow({
              id: "e2",
              meta: { at: "2026-06-18T02:00:00.000Z", source: null },
            }),
          ],
          ACTIVITY_ROW_COLUMNS,
        ),
      },
    ]);

    const events = await listIssueActivity(
      makeAdapter(),
      "reef-sample",
      "REEF-063",
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("e1");
  });
});
