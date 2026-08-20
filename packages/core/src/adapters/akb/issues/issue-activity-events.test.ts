import { describe, expect, it } from "vitest";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import {
  ALL_REEF_TABLES,
  ACTIVITY_EVENT_ISSUE_BODY_MENTIONS_CHANGE,
  REEF_ACTIVITY_TABLE,
  SAMPLE_ISSUE,
  activityEventKey,
  appendActivityEvents,
  appendIssueBodyMentionsChangeEvent,
  appendStatusChangeEvent,
  diffFieldActivityEvents,
  listIssueActivity,
  makeAdapter,
  makeListTablesResponse,
  makeSqlMutationResponse,
  makeSqlQueryResponse,
  makeSqlRuntimeErrorResponse,
  reconcileJiraChangelogActivityEvents,
  reconcileJiraImportedAttachmentActivityActor,
  setupFetch,
  statusChangeEventKey,
} from "../core/akb.testSupport";

// REEF-063: the immutable issue activity log (reef_activity).

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

describe("issue body mention activity", () => {
  it("uses the document commit as its idempotency key", () => {
    expect(
      activityEventKey(
        {
          eventType: ACTIVITY_EVENT_ISSUE_BODY_MENTIONS_CHANGE,
          payload: {
            recipients: ["alice"],
            added: ["alice"],
            removed: [],
            document_commit: "commit-mentions",
          },
        },
        "2026-07-01T00:00:00.000Z",
      ),
    ).toBe("issue_body_mentions_change:commit-mentions");
  });

  it("stores the canonical delta payload with the normal activity schema", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([{ id: "mention-event" }], ["id"]) },
    ]);

    await appendIssueBodyMentionsChangeEvent(makeAdapter(), "reef-sample", {
      reefId: SAMPLE_ISSUE.id,
      recipients: ["alice", "bob"],
      added: ["bob"],
      removed: ["carol"],
      documentCommit: "commit-mentions",
      at: "2026-07-01T00:00:00.000Z",
      actor: "alice",
      source: "web",
    });

    expect(calls).toHaveLength(2);
    const sql = lastSql(calls[1]?.init?.body);
    expect(sql).toContain("issue_body_mentions_change:commit-mentions");
    expect(sql).toContain('"recipients":["alice","bob"]');
    expect(sql).toContain('"added":["bob"]');
    expect(sql).toContain('"removed":["carol"]');
    expect(sql).toContain('"document_commit":"commit-mentions"');
    expect(sql).toContain("WHERE NOT EXISTS");
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
    // Declared columns are used; akb reserved/auto columns are excluded.
    expect(insertSql).toContain(
      `("reef_id", "event_type", "event_key", "payload", "meta")`,
    );
    expect(insertSql).not.toContain("created_by");
    // Idempotency is enforced in the same statement: insert when the
    // (reef_id, event_key) row not already exist.
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

  it("does not expose the internal mention precursor in the user timeline", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            makeActivityRow({
              id: "mention-event",
              event_type: ACTIVITY_EVENT_ISSUE_BODY_MENTIONS_CHANGE,
              event_key: "issue_body_mentions_change:commit-mentions",
              payload: {
                recipients: ["alice"],
                added: ["alice"],
                removed: [],
                document_commit: "commit-mentions",
              },
            }),
            makeActivityRow({ id: "status-event" }),
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

    expect(events.map((event) => event.id)).toEqual(["status-event"]);
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

describe("activityEventKey (REEF-277)", () => {
  const at = "2026-06-18T03:00:00.000Z";

  it("keys the from→to family (title/due/parent/estimate/archived) on from→to", () => {
    expect(
      activityEventKey(
        { eventType: "title_change", payload: { from: "Old", to: "New" } },
        at,
      ),
    ).toBe(`title_change:Old->New@${at}`);
    expect(
      activityEventKey(
        {
          eventType: "due_date_change",
          payload: { from: null, to: "2026-07-01T00:00:00.000Z" },
        },
        at,
      ),
    ).toBe(`due_date_change:∅->2026-07-01T00:00:00.000Z@${at}`);
    expect(
      activityEventKey(
        { eventType: "parent_change", payload: { from: "REEF-001", to: null } },
        at,
      ),
    ).toBe(`parent_change:REEF-001->∅@${at}`);
    // numbers render as digits — 0 is a real value, not the null token.
    expect(
      activityEventKey(
        { eventType: "estimate_change", payload: { from: 0, to: 5 } },
        at,
      ),
    ).toBe(`estimate_change:0->5@${at}`);
    // booleans render as false/true.
    expect(
      activityEventKey(
        { eventType: "archived_change", payload: { from: false, to: true } },
        at,
      ),
    ).toBe(`archived_change:false->true@${at}`);
  });

  it("keys set changes (labels/relation) on sorted added/removed, order-insensitive", () => {
    expect(
      activityEventKey(
        {
          eventType: "labels_change",
          payload: { added: ["frontend", "bug"], removed: ["chore"] },
        },
        at,
      ),
    ).toBe(`labels_change:+bug,frontend:-chore@${at}`);
    expect(
      activityEventKey(
        {
          eventType: "relation_change",
          payload: { relation: "blocks", added: ["REEF-010"], removed: [] },
        },
        at,
      ),
    ).toBe(`relation_change:blocks:+REEF-010:-@${at}`);
  });
});

describe("activityEventKey (REEF-349)", () => {
  const at = "2026-07-09T01:00:00.000Z";
  const payload = {
    attachment_id: "att-1",
    file_uri: "akb://reef-test/issues/file/file-1",
    filename: "screenshot.png",
    mime_type: "image/png",
    size_bytes: 42,
  };

  it("keys attachment events by attachment id and timestamp", () => {
    expect(
      activityEventKey({ eventType: "attachment_added", payload }, at),
    ).toBe(`attachment_added:att-1@${at}`);
    expect(
      activityEventKey({ eventType: "attachment_removed", payload }, at),
    ).toBe(`attachment_removed:att-1@${at}`);
  });
});
