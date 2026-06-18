import { describe, expect, it } from "vitest";
import type { IssueMetadata } from "../schemas/issues/metadata";
import {
  ALL_REEF_TABLES,
  REEF_ACTIVITY_TABLE,
  REEF_ISSUES_TABLE,
  SAMPLE_ISSUE,
  activityEventKey,
  appendActivityEvents,
  appendStatusChangeEvent,
  diffFieldActivityEvents,
  listIssueActivity,
  listRecentActivity,
  makeAdapter,
  makeListTablesResponse,
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
  it("provisions, then conditionally inserts only declared columns in one statement", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) }, // ensureReefTables
      { body: makeSqlQueryResponse([{ id: "new-uuid" }], ["id"]) }, // INSERT … RETURNING id
    ]);

    await appendStatusChangeEvent(makeAdapter(), "reef-sample", {
      reefId: "REEF-063",
      from: "todo",
      to: "in_progress",
      at: "2026-06-18T01:00:00.000Z",
      actor: "alice",
      source: "ai-agent:user_request",
    });

    // One provisioning call + one conditional insert — no separate probe.
    expect(calls).toHaveLength(2);

    const insertSql = lastSql(calls[1]?.init?.body);
    expect(insertSql).toContain(`INSERT INTO ${REEF_ACTIVITY_TABLE}`);
    // Only declared columns — never the akb reserved/auto columns.
    expect(insertSql).toContain(
      `("reef_id", "event_type", "event_key", "payload", "meta")`,
    );
    expect(insertSql).not.toContain("created_by");
    // Idempotency is enforced in the same statement: insert only when the
    // (reef_id, event_key) row does not already exist.
    expect(insertSql).toContain("WHERE NOT EXISTS");
    expect(insertSql).toContain(`SELECT 1 FROM ${REEF_ACTIVITY_TABLE}`);
    expect(insertSql).toContain("reef_id = 'REEF-063'");
    expect(insertSql).toContain(
      "event_key = 'status_change:todo->in_progress@2026-06-18T01:00:00.000Z'",
    );
    expect(insertSql).toContain("'status_change'");
    expect(insertSql).toContain('"from":"todo"');
    expect(insertSql).toContain('"to":"in_progress"');
    // Semantic actor / event time / provenance live in meta.
    expect(insertSql).toContain('"actor":"alice"');
    expect(insertSql).toContain('"at":"2026-06-18T01:00:00.000Z"');
    expect(insertSql).toContain('"source":"ai-agent:user_request"');
  });

  it("is idempotent: the NOT EXISTS guard records nothing when the event already exists", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) }, // ensureReefTables
      { body: makeSqlQueryResponse([], ["id"]) }, // INSERT … RETURNING id → 0 rows (guard matched)
    ]);

    // The call still issues the single conditional insert; the DB skips the row
    // because the event already exists, so no duplicate is written.
    await appendStatusChangeEvent(makeAdapter(), "reef-sample", {
      reefId: "REEF-063",
      from: "todo",
      to: "in_progress",
      at: "2026-06-18T01:00:00.000Z",
      actor: "alice",
    });

    expect(calls).toHaveLength(2);
    const insertSql = lastSql(calls[1]?.init?.body);
    expect(insertSql).toContain("WHERE NOT EXISTS");
  });

  it("defaults meta.source to null when no provenance is given", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([{ id: "new-uuid" }], ["id"]) },
    ]);

    await appendStatusChangeEvent(makeAdapter(), "reef-sample", {
      reefId: "REEF-063",
      from: "in_progress",
      to: "in_review",
      at: "2026-06-18T02:00:00.000Z",
      actor: "bob",
    });

    const insertSql = lastSql(calls[1]?.init?.body);
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

// REEF-077: the vault-wide recent-activity feed projection — events joined to
// their issue title, distinct from listIssueActivity's single-issue history.
const RECENT_ACTIVITY_ROW_COLUMNS = [...ACTIVITY_ROW_COLUMNS, "issue_title"];

function makeRecentRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...makeActivityRow(),
    issue_title: "Some issue title",
    ...overrides,
  };
}

describe("listRecentActivity", () => {
  it("joins the issue title, orders newest-first, and applies since + limit", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            makeRecentRow({
              id: "e2",
              reef_id: "REEF-101",
              issue_title: "Newer issue",
              payload: { from: "in_progress", to: "in_review" },
              meta: {
                actor: "bob",
                at: "2026-06-18T02:00:00.000Z",
                source: null,
              },
            }),
            makeRecentRow({
              id: "e1",
              reef_id: "REEF-063",
              issue_title: "Older issue",
              payload: { from: "todo", to: "in_progress" },
              meta: {
                actor: "alice",
                at: "2026-06-18T01:00:00.000Z",
                source: "ai-agent:user_request",
              },
            }),
          ],
          RECENT_ACTIVITY_ROW_COLUMNS,
        ),
      },
    ]);

    const events = await listRecentActivity(makeAdapter(), "reef-sample", {
      since: "2026-06-18T00:00:00.000Z",
      limit: 50,
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      id: "e2",
      reef_id: "REEF-101",
      issue_title: "Newer issue",
      payload: { from: "in_progress", to: "in_review" },
      actor: "bob",
    });
    expect(events[1]).toMatchObject({
      reef_id: "REEF-063",
      issue_title: "Older issue",
      actor: "alice",
    });

    const sql = lastSql(calls[0]?.init?.body);
    // Vault-wide read joins the issue title so the feed renders a link in one
    // round trip.
    expect(sql).toContain(`FROM ${REEF_ACTIVITY_TABLE} a`);
    expect(sql).toContain(
      `JOIN ${REEF_ISSUES_TABLE} i ON i.reef_id = a.reef_id`,
    );
    expect(sql).toContain("i.title AS issue_title");
    // `since` is an exclusive lower bound on the semantic event time.
    expect(sql).toContain("a.meta->>'at' > '2026-06-18T00:00:00.000Z'");
    expect(sql).toContain("ORDER BY a.meta->>'at' DESC, a.id DESC");
    expect(sql).toContain("LIMIT 50");
  });

  it("omits the since clause and uses the default limit when no options are given", async () => {
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([], RECENT_ACTIVITY_ROW_COLUMNS) },
    ]);

    const events = await listRecentActivity(makeAdapter(), "reef-sample");

    expect(events).toEqual([]);
    const sql = lastSql(calls[0]?.init?.body);
    expect(sql).not.toContain("WHERE");
    expect(sql).toContain("LIMIT 100");
  });

  it("clamps an oversized limit to the hard maximum", async () => {
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([], RECENT_ACTIVITY_ROW_COLUMNS) },
    ]);

    await listRecentActivity(makeAdapter(), "reef-sample", { limit: 100_000 });

    const sql = lastSql(calls[0]?.init?.body);
    expect(sql).toContain("LIMIT 500");
  });

  it("returns an empty feed for an unprovisioned vault (no reconcile)", async () => {
    const { calls } = setupFetch([
      makeSqlRuntimeErrorResponse(REEF_ACTIVITY_TABLE),
    ]);

    const events = await listRecentActivity(makeAdapter(), "reef-sample");

    expect(events).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("skips a malformed row rather than blanking the whole feed", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            makeRecentRow({ id: "e1" }),
            // missing meta.actor → fails ActivityEventMetaSchema
            makeRecentRow({
              id: "e2",
              meta: { at: "2026-06-18T02:00:00.000Z", source: null },
            }),
            // present event but missing the joined title → fails the feed schema
            makeRecentRow({ id: "e3", issue_title: "" }),
          ],
          RECENT_ACTIVITY_ROW_COLUMNS,
        ),
      },
    ]);

    const events = await listRecentActivity(makeAdapter(), "reef-sample");

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("e1");
  });
});

// ── REEF-126: non-status field-change events ──────────────────────────────────

describe("activityEventKey (REEF-126)", () => {
  const at = "2026-06-18T03:00:00.000Z";

  it("keys assignee/priority on from→to, with a token for a null segment", () => {
    expect(
      activityEventKey(
        { eventType: "assignee_change", payload: { from: "alice", to: "bob" } },
        at,
      ),
    ).toBe(`assignee_change:alice->bob@${at}`);
    expect(
      activityEventKey(
        { eventType: "assignee_change", payload: { from: null, to: "bob" } },
        at,
      ),
    ).toBe(`assignee_change:∅->bob@${at}`);
    expect(
      activityEventKey(
        { eventType: "priority_change", payload: { from: "high", to: null } },
        at,
      ),
    ).toBe(`priority_change:high->∅@${at}`);
  });

  it("keys planning_link by dimension and impl_ref_linked by ref identity", () => {
    expect(
      activityEventKey(
        {
          eventType: "planning_link",
          payload: { field: "sprint", from: null, to: "spr-3" },
        },
        at,
      ),
    ).toBe(`planning_link:sprint:∅->spr-3@${at}`);
    expect(
      activityEventKey(
        {
          eventType: "impl_ref_linked",
          payload: {
            ref_type: "pull_request",
            ref: "42",
            repo: "dnotitia/reef",
          },
        },
        at,
      ),
    ).toBe(`impl_ref_linked:pull_request:dnotitia/reef:42@${at}`);
    expect(
      activityEventKey(
        {
          eventType: "impl_ref_linked",
          payload: { ref_type: "commit", ref: "abc", repo: null },
        },
        at,
      ),
    ).toBe(`impl_ref_linked:commit:∅:abc@${at}`);
  });
});

describe("diffFieldActivityEvents (REEF-126)", () => {
  const meta = {
    at: "2026-06-18T04:00:00.000Z",
    actor: "carol",
    source: "ai-agent:user_request",
  };
  const diff = (after: Partial<IssueMetadata>) =>
    diffFieldActivityEvents(
      "REEF-126",
      SAMPLE_ISSUE,
      { ...SAMPLE_ISSUE, ...after },
      meta,
    );

  it("emits nothing when no tracked field changed", () => {
    expect(diff({ title: "a new title" })).toEqual([]);
  });

  it("emits an assignee_change carrying the from→to actors, actor, and at", () => {
    const events = diff({ assigned_to: "bob" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      reefId: "REEF-126",
      eventType: "assignee_change",
      payload: { from: "alice", to: "bob" },
      at: meta.at,
      actor: "carol",
      source: "ai-agent:user_request",
    });
  });

  it("treats clearing assignee/priority as a transition to null", () => {
    const events = diff({ assigned_to: null, priority: null });
    expect(events.map((e) => e.eventType).sort()).toEqual([
      "assignee_change",
      "priority_change",
    ]);
    expect(
      events.find((e) => e.eventType === "assignee_change")?.payload,
    ).toEqual({ from: "alice", to: null });
    expect(
      events.find((e) => e.eventType === "priority_change")?.payload,
    ).toEqual({ from: "high", to: null });
  });

  it("groups every field changed in one save under the one shared timestamp (AC3)", () => {
    const events = diff({
      assigned_to: "bob",
      priority: "low",
      sprint_id: "spr-7",
    });
    expect(events).toHaveLength(3);
    expect(new Set(events.map((e) => e.at))).toEqual(new Set([meta.at]));
    expect(
      events.find((e) => e.eventType === "planning_link")?.payload,
    ).toEqual({ field: "sprint", from: null, to: "spr-7" });
  });

  it("emits one planning_link per changed dimension, labeled by field", () => {
    const events = diff({ milestone_id: "ms-1", release_id: "rel-2" });
    expect(
      events
        .map((e) =>
          e.eventType === "planning_link" ? e.payload.field : e.eventType,
        )
        .sort(),
    ).toEqual(["milestone", "release"]);
  });

  it("emits impl_ref_linked only for newly-linked refs, not pre-existing ones", () => {
    const before: IssueMetadata = {
      ...SAMPLE_ISSUE,
      implementation_refs: [
        { type: "commit", ref: "old", repo: "dnotitia/reef" },
      ],
    };
    const after: IssueMetadata = {
      ...SAMPLE_ISSUE,
      implementation_refs: [
        { type: "commit", ref: "old", repo: "dnotitia/reef" },
        { type: "pull_request", ref: "42", repo: "dnotitia/reef" },
      ],
    };
    const events = diffFieldActivityEvents("REEF-126", before, after, meta);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "impl_ref_linked",
      payload: { ref_type: "pull_request", ref: "42", repo: "dnotitia/reef" },
    });
  });
});

describe("appendActivityEvents (REEF-126)", () => {
  const at = "2026-06-18T05:00:00.000Z";
  const events = diffFieldActivityEvents(
    "REEF-126",
    SAMPLE_ISSUE,
    { ...SAMPLE_ISSUE, assigned_to: "bob", priority: "low" },
    { at, actor: "carol", source: null },
  );

  it("provisions once, then conditionally inserts one row per event", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) }, // ensureReefTables (once)
      { body: makeSqlQueryResponse([{ id: "e1" }], ["id"]) }, // INSERT assignee
      { body: makeSqlQueryResponse([{ id: "e2" }], ["id"]) }, // INSERT priority
    ]);

    await appendActivityEvents(makeAdapter(), "reef-sample", events);

    expect(events.map((e) => e.eventType)).toEqual([
      "assignee_change",
      "priority_change",
    ]);
    expect(calls).toHaveLength(3);
    const insert1 = lastSql(calls[1]?.init?.body);
    expect(insert1).toContain("'assignee_change'");
    expect(insert1).toContain(`'assignee_change:alice->bob@${at}'`);
    expect(insert1).toContain("WHERE NOT EXISTS");
    expect(insert1).toContain('"from":"alice"');
    const insert2 = lastSql(calls[2]?.init?.body);
    expect(insert2).toContain("'priority_change'");
    expect(insert2).toContain(`'priority_change:high->low@${at}'`);
  });

  it("no-ops without a single fetch when there are no events", async () => {
    const { calls } = setupFetch([]);
    await appendActivityEvents(makeAdapter(), "reef-sample", []);
    expect(calls).toHaveLength(0);
  });
});

describe("listIssueActivity reads the REEF-126 event types", () => {
  function activityRow(overrides: {
    id: string;
    event_type: string;
    at: string;
    payload: unknown;
  }): Record<string, unknown> {
    return {
      id: overrides.id,
      reef_id: "REEF-126",
      event_type: overrides.event_type,
      event_key: `${overrides.event_type}@${overrides.at}`,
      payload: overrides.payload,
      meta: { actor: "carol", at: overrides.at, source: null },
      created_at: "2026-06-18T06:00:00.123456+00",
      updated_at: "2026-06-18T06:00:00.123456+00",
      created_by: "akb-principal",
    };
  }

  it("projects each event_type's payload through the matching schema", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            activityRow({
              id: "a",
              event_type: "assignee_change",
              at: "2026-06-18T06:00:01.000Z",
              payload: { from: "alice", to: "bob" },
            }),
            activityRow({
              id: "p",
              event_type: "priority_change",
              at: "2026-06-18T06:00:02.000Z",
              payload: { from: "high", to: null },
            }),
            activityRow({
              id: "pl",
              event_type: "planning_link",
              at: "2026-06-18T06:00:03.000Z",
              payload: { field: "sprint", from: null, to: "spr-3" },
            }),
            activityRow({
              id: "ir",
              event_type: "impl_ref_linked",
              at: "2026-06-18T06:00:04.000Z",
              payload: {
                ref_type: "pull_request",
                ref: "42",
                repo: "dnotitia/reef",
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
      "REEF-126",
    );

    expect(events.map((e) => e.event_type)).toEqual([
      "assignee_change",
      "priority_change",
      "planning_link",
      "impl_ref_linked",
    ]);
    expect(events[0]?.payload).toEqual({ from: "alice", to: "bob" });
    expect(events[3]?.payload).toEqual({
      ref_type: "pull_request",
      ref: "42",
      repo: "dnotitia/reef",
    });
  });

  it("skips a row whose event_type this release cannot model", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            activityRow({
              id: "known",
              event_type: "assignee_change",
              at: "2026-06-18T06:00:01.000Z",
              payload: { from: null, to: "alice" },
            }),
            activityRow({
              id: "future",
              event_type: "title_change",
              at: "2026-06-18T06:00:02.000Z",
              payload: { from: "x", to: "y" },
            }),
          ],
          ACTIVITY_ROW_COLUMNS,
        ),
      },
    ]);

    const events = await listIssueActivity(
      makeAdapter(),
      "reef-sample",
      "REEF-126",
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe("assignee_change");
  });
});
