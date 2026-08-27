import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "../../../errors";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import {
  type FetchCall,
  makeIssueQueryResponse,
  makeTestAkbAdapter,
  setupFetch,
} from "../../../test-support/akb/fetchMock";
import { mockOpenTelemetry } from "../../../test-support/akb/otelMock";
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
    expect(updateBody.params).toEqual(
      expect.arrayContaining(["REEF-003", 1500, "high", "carol"]),
    );
  });
});
