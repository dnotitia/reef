import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "../../../errors";
import { buildSubscriptionKey } from "../../../schemas/notifications";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import {
  type FetchCall,
  makeIssueQueryResponse,
  makeTestAkbAdapter,
  setupFetch,
} from "../../../test-support/akb/fetchMock";
import { mockOpenTelemetry } from "../../../test-support/akb/otelMock";
import { makeSqlQueryResponse } from "../core/akb.testSupport";
import { reorderIssue } from "./issues";

mockOpenTelemetry();

const VAULT = "reef-acme";

function makeIssue(over: Partial<IssueMetadata> = {}): IssueMetadata {
  return {
    id: "REEF-001",
    title: "Issue",
    status: "todo",
    labels: ["bug"],
    depends_on: [],
    related_to: [],
    blocks: [],
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
    ...over,
  };
}

function rankedRows() {
  return makeIssueQueryResponse([
    makeIssue({
      id: "REEF-001",
      rank: 1000,
      updated_at: "2026-05-01T00:00:00.000Z",
    }),
    makeIssue({
      id: "REEF-002",
      rank: 2000,
      updated_at: "2026-05-01T00:00:00.000Z",
    }),
    makeIssue({
      id: "REEF-003",
      rank: 3000,
      updated_at: "2026-05-01T00:00:00.000Z",
    }),
  ]);
}

function bodyOf(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init?.body));
}

function subscriptionRow(subscriber: string) {
  return {
    id: "018f47a4-8e3b-7f62-a3d2-9876543210ab",
    subscription_key: buildSubscriptionKey({
      reefId: "REEF-003",
      subscriber,
      source: "assignee",
    }),
    reef_id: "REEF-003",
    subscriber,
    source: "assignee",
    status: "active",
    subscribed_at: "2026-05-02T00:00:00.000Z",
    meta: null,
  };
}

function expectStatusTimestampOnlyFor(
  updateBody: Record<string, unknown>,
  issueId: string,
) {
  const sql = String(updateBody.sql);
  const metaAssignment = sql
    .split('"meta" = ')[1]
    ?.split(' WHERE "reef_id" IN (')[0];
  expect(metaAssignment).toBeDefined();
  if (!metaAssignment) return;

  const targetParameter = /^CASE WHEN "reef_id" = \$(\d+) THEN/.exec(
    metaAssignment,
  );
  expect(targetParameter).not.toBeNull();
  const params = Array.isArray(updateBody.params) ? updateBody.params : [];
  expect(params[Number(targetParameter?.[1]) - 1]).toBe(issueId);
  expect(metaAssignment).toContain("'{last_status_change}'");
  expect(metaAssignment).toContain(
    "ELSE jsonb_set(COALESCE(\"meta\"::jsonb, '{}'::jsonb), '{last_editor}'",
  );
}

describe("reorderIssue (REEF-570)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("computes canonical ranks from anchors rather than a client page", async () => {
    const { calls } = setupFetch([
      { body: rankedRows() },
      {
        body: {
          kind: "table_query",
          columns: ["reef_id"],
          items: [{ reef_id: "REEF-003" }],
          total: 1,
        },
      },
    ]);

    const result = await reorderIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      scope: "active",
      issueId: "REEF-003",
      beforeId: "REEF-001",
      afterId: "REEF-002",
      expected: {
        issueRank: 3000,
        issueUpdatedAt: "2026-05-01T00:00:00.000Z",
        beforeRank: 1000,
        beforeUpdatedAt: "2026-05-01T00:00:00.000Z",
        afterRank: 2000,
        afterUpdatedAt: "2026-05-01T00:00:00.000Z",
      },
      actor: "carol",
      at: "2026-05-02T00:00:00.000Z",
    });

    expect(result.assignments).toEqual([{ id: "REEF-003", rank: 1500 }]);
    const updateBody = bodyOf(calls[1]);
    const sql = String(updateBody.sql);
    expect(sql).toContain('SET "rank" = CASE "reef_id"');
    expect(sql).toContain("WHEN $1 THEN $2");
    expect(sql).toContain("IS DISTINCT FROM");
    expect(sql).toMatch(
      /"updated_at" IS DISTINCT FROM \(\(\$\d+::text\)::timestamptz\)/,
    );
    expect(updateBody.params).toEqual(
      expect.arrayContaining(["REEF-003", 1500, "carol"]),
    );
    expect(String(bodyOf(calls[0]).sql)).toContain("ORDER BY");
  });

  it("rejects a stale neighbour before issuing a write", async () => {
    const { calls } = setupFetch([{ body: rankedRows() }]);

    await expect(
      reorderIssue({
        adapter: makeTestAkbAdapter(),
        vault: VAULT,
        scope: "active",
        issueId: "REEF-003",
        beforeId: "REEF-001",
        afterId: "REEF-002",
        expected: {
          issueRank: 3000,
          issueUpdatedAt: "2026-05-01T00:00:00.000Z",
          beforeRank: 999,
          beforeUpdatedAt: "2026-05-01T00:00:00.000Z",
          afterRank: 2000,
          afterUpdatedAt: "2026-05-01T00:00:00.000Z",
        },
        actor: "carol",
        at: "2026-05-02T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(calls).toHaveLength(1);
  });

  it("interprets a null after anchor as the canonical scope tail", async () => {
    const { calls } = setupFetch([
      { body: rankedRows() },
      {
        body: {
          kind: "table_query",
          columns: ["reef_id", "rank", "updated_at"],
          items: [
            {
              reef_id: "REEF-001",
              rank: 4000,
              updated_at: "2026-05-02T00:00:00.000Z",
            },
          ],
          total: 1,
        },
      },
    ]);

    await reorderIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      scope: "active",
      issueId: "REEF-001",
      beforeId: "REEF-002",
      afterId: null,
      expected: {
        issueRank: 1000,
        issueUpdatedAt: "2026-05-01T00:00:00.000Z",
        beforeRank: 2000,
        beforeUpdatedAt: "2026-05-01T00:00:00.000Z",
        afterRank: null,
        afterUpdatedAt: null,
      },
      actor: "carol",
      at: "2026-05-02T00:00:00.000Z",
    });

    const updateBody = bodyOf(calls[1]);
    expect(String(updateBody.sql)).toContain("THEN $2");
    expect(updateBody.params).toContain(4000);
  });

  it("preserves neighbor status times when materializing an unranked tail", async () => {
    const rows = makeIssueQueryResponse([
      makeIssue({
        id: "REEF-001",
        status: "done",
        rank: null,
        last_status_change: "2026-05-01T00:00:00.000Z",
      }),
      makeIssue({
        id: "REEF-002",
        status: "closed",
        rank: null,
        closed_at: "2026-05-01T00:00:00.000Z",
        closed_reason: "completed",
      }),
      makeIssue({
        id: "REEF-003",
        status: "todo",
        rank: null,
      }),
    ]) as { items: Array<Record<string, unknown>> };
    rows.items[1].closed_at = "2026-05-01T00:00:00.000Z";
    rows.items[1].closed_reason = "completed";
    const absentTimestampMeta = rows.items[2].meta as Record<string, unknown>;
    delete absentTimestampMeta.last_status_change;
    const { calls } = setupFetch([
      { body: rows },
      {
        body: {
          kind: "table_query",
          columns: ["reef_id", "rank", "updated_at"],
          items: [
            {
              reef_id: "REEF-002",
              rank: 1000,
              updated_at: "2026-05-02T00:00:00.000Z",
            },
            {
              reef_id: "REEF-003",
              rank: 2000,
              updated_at: "2026-05-02T00:00:00.000Z",
            },
            {
              reef_id: "REEF-001",
              rank: 3000,
              updated_at: "2026-05-02T00:00:00.000Z",
            },
          ],
          total: 3,
        },
      },
      { body: makeSqlQueryResponse([{ id: "status-event" }], ["id"]) },
    ]);

    const result = await reorderIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      scope: "active",
      issueId: "REEF-001",
      beforeId: "REEF-003",
      afterId: null,
      expected: {
        issueRank: null,
        issueUpdatedAt: "2026-05-01T00:00:00.000Z",
        beforeRank: null,
        beforeUpdatedAt: "2026-05-01T00:00:00.000Z",
        afterRank: null,
        afterUpdatedAt: null,
      },
      group: { field: "status", value: "in_progress" },
      actor: "carol",
      at: "2026-05-02T00:00:00.000Z",
    });

    expect(result.assignments).toMatchObject([
      { id: "REEF-002", rank: 1000 },
      { id: "REEF-003", rank: 2000 },
      { id: "REEF-001", rank: 3000 },
    ]);
    const updateBody = bodyOf(calls[1]);
    expectStatusTimestampOnlyFor(updateBody, "REEF-001");
    expect(String(updateBody.sql)).toContain('"closed_at" = CASE "reef_id"');
    expect(String(updateBody.sql)).toMatch(
      /"closed_reason" = CASE "reef_id" WHEN \$\d+ THEN NULL ELSE "closed_reason" END/,
    );
    const activityBody = bodyOf(calls[2]);
    expect(activityBody.params).toEqual(
      expect.arrayContaining([
        "REEF-001",
        "status_change:done->in_progress@2026-05-02T00:00:00.000Z",
      ]),
    );
    expect(calls).toHaveLength(3);
  });

  it("preserves neighbor status times when exhausted ranks are re-spaced", async () => {
    const rows = makeIssueQueryResponse([
      makeIssue({
        id: "REEF-001",
        status: "closed",
        rank: 1,
        last_status_change: "2026-05-01T00:00:00.000Z",
      }),
      makeIssue({ id: "REEF-002", status: "done", rank: 1 + Number.EPSILON }),
      makeIssue({
        id: "REEF-003",
        status: "todo",
        rank: 3000,
      }),
      makeIssue({ id: "REEF-004", status: "in_progress", rank: null }),
    ]);
    const { calls } = setupFetch([
      { body: rows },
      {
        body: {
          kind: "table_query",
          columns: ["reef_id", "rank", "updated_at"],
          items: [
            {
              reef_id: "REEF-001",
              rank: 1000,
              updated_at: "2026-05-02T00:00:00.000Z",
            },
            {
              reef_id: "REEF-003",
              rank: 2000,
              updated_at: "2026-05-02T00:00:00.000Z",
            },
            {
              reef_id: "REEF-002",
              rank: 3000,
              updated_at: "2026-05-02T00:00:00.000Z",
            },
          ],
          total: 3,
        },
      },
      { body: makeSqlQueryResponse([{ id: "status-event" }], ["id"]) },
    ]);

    const result = await reorderIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      scope: "active",
      issueId: "REEF-003",
      beforeId: "REEF-001",
      afterId: "REEF-002",
      expected: {
        issueRank: 3000,
        issueUpdatedAt: "2026-05-01T00:00:00.000Z",
        beforeRank: 1,
        beforeUpdatedAt: "2026-05-01T00:00:00.000Z",
        afterRank: 1 + Number.EPSILON,
        afterUpdatedAt: "2026-05-01T00:00:00.000Z",
      },
      group: { field: "status", value: "in_progress" },
      actor: "carol",
      at: "2026-05-02T00:00:00.000Z",
    });

    expect(result.assignments).toMatchObject([
      { id: "REEF-001", rank: 1000 },
      { id: "REEF-003", rank: 2000 },
      { id: "REEF-002", rank: 3000 },
    ]);
    expectStatusTimestampOnlyFor(bodyOf(calls[1]), "REEF-003");
    expect(bodyOf(calls[2]).params).toEqual(
      expect.arrayContaining([
        "REEF-003",
        "status_change:todo->in_progress@2026-05-02T00:00:00.000Z",
      ]),
    );
    expect(calls).toHaveLength(3);
  });

  it("stamps a single issue on a status-only move", async () => {
    const { calls } = setupFetch([
      {
        body: makeIssueQueryResponse([
          makeIssue({
            id: "REEF-001",
            status: "todo",
            rank: 1000,
            last_status_change: "2026-05-01T00:00:00.000Z",
          }),
        ]),
      },
      {
        body: {
          kind: "table_query",
          columns: ["reef_id", "rank", "updated_at"],
          items: [
            {
              reef_id: "REEF-001",
              rank: 1000,
              updated_at: "2026-05-02T00:00:00.000Z",
            },
          ],
          total: 1,
        },
      },
      { body: makeSqlQueryResponse([{ id: "status-event" }], ["id"]) },
    ]);

    await reorderIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      scope: "active",
      issueId: "REEF-001",
      beforeId: null,
      afterId: null,
      expected: {
        issueRank: 1000,
        issueUpdatedAt: "2026-05-01T00:00:00.000Z",
        beforeRank: null,
        beforeUpdatedAt: null,
        afterRank: null,
        afterUpdatedAt: null,
      },
      group: { field: "status", value: "in_progress" },
      actor: "carol",
      at: "2026-05-02T00:00:00.000Z",
    });

    expectStatusTimestampOnlyFor(bodyOf(calls[1]), "REEF-001");
    expect(bodyOf(calls[2]).params).toEqual(
      expect.arrayContaining([
        "REEF-001",
        "status_change:todo->in_progress@2026-05-02T00:00:00.000Z",
      ]),
    );
    expect(calls).toHaveLength(3);
  });

  it("does not change status time on a same-status reorder", async () => {
    const { calls } = setupFetch([
      {
        body: makeIssueQueryResponse([
          makeIssue({ id: "REEF-001", status: "done", rank: 1000 }),
          makeIssue({ id: "REEF-002", status: "done", rank: 2000 }),
          makeIssue({ id: "REEF-003", status: "done", rank: 3000 }),
        ]),
      },
      {
        body: {
          kind: "table_query",
          columns: ["reef_id", "rank", "updated_at"],
          items: [
            {
              reef_id: "REEF-003",
              rank: 1500,
              updated_at: "2026-05-02T00:00:00.000Z",
            },
          ],
          total: 1,
        },
      },
    ]);

    await reorderIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      scope: "active",
      issueId: "REEF-003",
      beforeId: "REEF-001",
      afterId: "REEF-002",
      expected: {
        issueRank: 3000,
        issueUpdatedAt: "2026-05-01T00:00:00.000Z",
        beforeRank: 1000,
        beforeUpdatedAt: "2026-05-01T00:00:00.000Z",
        afterRank: 2000,
        afterUpdatedAt: "2026-05-01T00:00:00.000Z",
      },
      group: { field: "status", value: "done" },
      actor: "carol",
      at: "2026-05-02T00:00:00.000Z",
    });

    const updateBody = bodyOf(calls[1]);
    expect(String(updateBody.sql)).not.toContain("'{last_status_change}'");
    expect(String(updateBody.sql)).toContain("'{last_editor}'");
    expect(updateBody.params).toContain("carol");
    expect(calls).toHaveLength(2);
  });

  it("applies a Board group change and rank in the same SQL update", async () => {
    const rows = makeIssueQueryResponse([
      makeIssue({ id: "REEF-001", rank: 1000, priority: "high" }),
      makeIssue({ id: "REEF-002", rank: 2000, priority: "high" }),
      makeIssue({ id: "REEF-003", rank: 3000, priority: "low" }),
    ]);
    const { calls } = setupFetch([
      { body: rows },
      {
        body: {
          kind: "table_query",
          columns: ["reef_id", "rank", "updated_at"],
          items: [
            {
              reef_id: "REEF-003",
              rank: 1500,
              updated_at: "2026-05-02T00:00:00.000Z",
            },
          ],
          total: 1,
        },
      },
    ]);

    await reorderIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      scope: "active",
      issueId: "REEF-003",
      beforeId: "REEF-001",
      afterId: "REEF-002",
      expected: {
        issueRank: 3000,
        issueUpdatedAt: "2026-05-01T00:00:00.000Z",
        beforeRank: 1000,
        beforeUpdatedAt: "2026-05-01T00:00:00.000Z",
        afterRank: 2000,
        afterUpdatedAt: "2026-05-01T00:00:00.000Z",
      },
      group: { field: "priority", value: "high" },
      actor: "carol",
      at: "2026-05-02T00:00:00.000Z",
    });

    const updateBody = bodyOf(calls[1]);
    const sql = String(updateBody.sql);
    expect(sql).toContain('"rank" = CASE "reef_id"');
    expect(sql).toContain('"priority" = CASE "reef_id"');
    expect(sql).toContain("THEN $4");
    expect(sql).toContain('"meta" =');
    expect(sql).not.toContain("'{last_status_change}'");
    expect(updateBody.params).toEqual(
      expect.arrayContaining(["REEF-003", 1500, "high", "carol"]),
    );
  });

  it("keeps automatic assignee subscriptions aligned with a Board group move", async () => {
    const rows = makeIssueQueryResponse([
      makeIssue({ id: "REEF-001", rank: 1000, assigned_to: "alice" }),
      makeIssue({ id: "REEF-002", rank: 2000, assigned_to: "bob" }),
      makeIssue({ id: "REEF-003", rank: 3000, assigned_to: "alice" }),
    ]);
    const { calls } = setupFetch([
      { body: rows },
      {
        body: {
          kind: "table_query",
          columns: ["reef_id", "rank", "updated_at"],
          items: [
            {
              reef_id: "REEF-003",
              rank: 1500,
              updated_at: "2026-05-02T00:00:00.000Z",
            },
          ],
          total: 1,
        },
      },
      {
        body: {
          kind: "table_query",
          columns: ["id"],
          items: [{ id: "removed-alice" }],
          total: 1,
        },
      },
      {
        body: {
          kind: "table_query",
          columns: Object.keys(subscriptionRow("bob")),
          items: [subscriptionRow("bob")],
          total: 1,
        },
      },
      { status: 500, body: { error: "activity unavailable" } },
    ]);

    await reorderIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      scope: "active",
      issueId: "REEF-003",
      beforeId: "REEF-001",
      afterId: "REEF-002",
      expected: {
        issueRank: 3000,
        issueUpdatedAt: "2026-05-01T00:00:00.000Z",
        beforeRank: 1000,
        beforeUpdatedAt: "2026-05-01T00:00:00.000Z",
        afterRank: 2000,
        afterUpdatedAt: "2026-05-01T00:00:00.000Z",
      },
      group: { field: "assigned_to", value: "bob" },
      actor: "carol",
      at: "2026-05-02T00:00:00.000Z",
    });

    const subscriptionRequests = calls.slice(2, 4).map(bodyOf);
    expect(subscriptionRequests).toHaveLength(2);
    expect(String(subscriptionRequests[0].sql)).toContain(
      "DELETE FROM reef_subscriptions",
    );
    expect(subscriptionRequests[0].params).toEqual([
      "REEF-003",
      "alice",
      "assignee",
    ]);
    expect(String(subscriptionRequests[1].sql)).toContain(
      "ON CONFLICT (subscription_key) DO UPDATE",
    );
    expect(subscriptionRequests[1].params).toEqual(
      expect.arrayContaining([
        buildSubscriptionKey({
          reefId: "REEF-003",
          subscriber: "bob",
          source: "assignee",
        }),
        "REEF-003",
        "bob",
        "assignee",
        "active",
      ]),
    );
  });
});
