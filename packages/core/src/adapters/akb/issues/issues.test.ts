import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FetchCall,
  makeIssueQueryResponse,
  makeTestAkbAdapter,
  setupFetch,
} from "../../../agents/tools/__test-helpers__/fetchMock";
import { mockOpenTelemetry } from "../../../agents/tools/__test-helpers__/otelMock";
import { AkbApiError, ConflictError } from "../../../errors";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import { reorderBacklogIssues, updateIssue, writeIssue } from "./issues";

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

/** The `GET /documents/{vault}/{path}` payload `readIssue` reads for the body. */
function docGetResponse(content: string): unknown {
  return {
    uri: `akb://${VAULT}/coll/issues/doc/reef-001.md`,
    vault: VAULT,
    path: "issues/reef-001.md",
    title: "REEF-001",
    type: "task",
    status: "active",
    summary: "Issue",
    current_commit: "commit-old",
    tags: ["bug"],
    content,
  };
}

/** The `PATCH /documents/...` (or POST) put-response envelope. */
function putResponse(commit: string): unknown {
  return {
    uri: `akb://${VAULT}/coll/issues/doc/reef-001.md`,
    vault: VAULT,
    path: "issues/reef-001.md",
    commit_hash: commit,
  };
}

const ROW_UPDATE_OK = { kind: "table_sql", result: "UPDATE 1" };

function patchCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((c) => c.init?.method === "PATCH");
}

function bodyOf(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init?.body));
}

describe("updateIssue → row-update compensation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("re-PATCHes the document to its prior values when the row UPDATE fails", async () => {
    const { calls } = setupFetch([
      { body: docGetResponse("old body") }, // readIssue GET
      { body: makeIssueQueryResponse([makeIssue()]) }, // readIssue selectIssueRows
      { body: putResponse("commit-new") }, // forward doc PATCH (succeeds)
      { status: 500, body: { error: "sql boom" } }, // row UPDATE (fails)
      { body: putResponse("commit-revert") }, // compensating re-PATCH
    ]);

    const err = await updateIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      id: "REEF-001",
      partial: {},
      content: "new body",
    }).catch((e) => e);

    // The original row-update error propagates, not a compensation error.
    expect(err).toBeInstanceOf(AkbApiError);
    expect((err as AkbApiError).status).toBe(500);

    // Forward PATCH carried the new body; the compensating PATCH rewound the
    // document to the prior body with a descriptive revert message.
    const patches = patchCalls(calls);
    expect(patches).toHaveLength(2);
    expect(bodyOf(patches[0]).content).toBe("new body");
    expect(bodyOf(patches[1]).content).toBe("old body");
    expect(bodyOf(patches[1]).message).toBe(
      "Revert REEF-001 document: row update failed",
    );
  });

  it("does not touch the document when a clean status edit's row UPDATE fails", async () => {
    const { calls } = setupFetch([
      { body: docGetResponse("body") }, // readIssue GET
      { body: makeIssueQueryResponse([makeIssue()]) }, // readIssue selectIssueRows
      { status: 500, body: { error: "sql boom" } }, // row UPDATE (fails)
    ]);

    const err = await updateIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      id: "REEF-001",
      partial: { priority: "high" }, // row field → docDirty=false
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AkbApiError);
    expect((err as AkbApiError).status).toBe(500);
    // docDirty=false: no document PATCH was ever issued, so there is nothing to
    // rewind — the existing "doc untouched" safety holds.
    expect(patchCalls(calls)).toHaveLength(0);
  });

  it("writes a backlog rank as a row-only update, never touching the document (REEF-129)", async () => {
    // A reorder just changes `rank`, a typed row column absent from the doc's
    // native-projected fields, so docDirty=false: no document PATCH, no git
    // commit — the row UPDATE the manual-order write depends on.
    const { calls } = setupFetch([
      { body: docGetResponse("body") }, // readIssue GET
      { body: makeIssueQueryResponse([makeIssue()]) }, // readIssue selectIssueRows
      { body: ROW_UPDATE_OK }, // row UPDATE succeeds
    ]);

    await updateIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      id: "REEF-001",
      partial: { rank: 1500 },
    });

    expect(patchCalls(calls)).toHaveLength(0);
  });

  it("keeps the original error when the compensating re-PATCH also fails", async () => {
    const { calls } = setupFetch([
      { body: docGetResponse("old body") },
      { body: makeIssueQueryResponse([makeIssue()]) },
      { body: putResponse("commit-new") }, // forward PATCH ok
      { status: 500, body: { error: "sql boom" } }, // row UPDATE fails
      { status: 503, body: { error: "revert boom" } }, // re-PATCH also fails
    ]);

    const err = await updateIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      id: "REEF-001",
      partial: {},
      content: "new body",
    }).catch((e) => e);

    // Best-effort compensation: the row-update 500 wins over the re-PATCH 503.
    expect(err).toBeInstanceOf(AkbApiError);
    expect((err as AkbApiError).status).toBe(500);
    expect(patchCalls(calls)).toHaveLength(2); // revert was still attempted
  });

  it("commits both stores and skips compensation on the happy path", async () => {
    const { calls } = setupFetch([
      { body: docGetResponse("old body") },
      { body: makeIssueQueryResponse([makeIssue()]) },
      { body: putResponse("commit-new") }, // forward PATCH
      { body: ROW_UPDATE_OK }, // row UPDATE succeeds
    ]);

    const res = await updateIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      id: "REEF-001",
      partial: {},
      content: "new body",
    });

    expect(res.commit_hash).toBe("commit-new");
    expect(res.content).toBe("new body");
    expect(res.issue.title).toBe("Issue");
    // Exactly one PATCH (the forward edit); no compensating re-PATCH.
    expect(patchCalls(calls)).toHaveLength(1);
  });
});

describe("updateIssue → document OCC (REEF-227)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards expectedCommit as expected_commit on the document PATCH", async () => {
    const { calls } = setupFetch([
      { body: docGetResponse("old body") },
      { body: makeIssueQueryResponse([makeIssue()]) },
      { body: putResponse("commit-new") }, // forward PATCH ok
      { body: ROW_UPDATE_OK },
    ]);

    await updateIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      id: "REEF-001",
      partial: {},
      content: "new body",
      expectedCommit: "commit-old",
    });

    const patches = patchCalls(calls);
    expect(patches).toHaveLength(1);
    expect(bodyOf(patches[0]).expected_commit).toBe("commit-old");
  });

  it("omits expected_commit when no base commit is given (stays last-write-wins)", async () => {
    const { calls } = setupFetch([
      { body: docGetResponse("old body") },
      { body: makeIssueQueryResponse([makeIssue()]) },
      { body: putResponse("commit-new") },
      { body: ROW_UPDATE_OK },
    ]);

    await updateIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      id: "REEF-001",
      partial: {},
      content: "new body",
    });

    expect(bodyOf(patchCalls(calls)[0])).not.toHaveProperty("expected_commit");
  });

  it("never sends the precondition on a row-only edit (no document PATCH)", async () => {
    const { calls } = setupFetch([
      { body: docGetResponse("body") },
      { body: makeIssueQueryResponse([makeIssue()]) },
      { body: ROW_UPDATE_OK },
    ]);

    await updateIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      id: "REEF-001",
      partial: { priority: "high" }, // docDirty=false
      expectedCommit: "commit-old",
    });

    // The precondition only guards document-projected fields; a row-only edit
    // touches no document, so there is no PATCH to attach it to.
    expect(patchCalls(calls)).toHaveLength(0);
  });

  it("surfaces a stale-base 409 as a ConflictError and never touches the row", async () => {
    const { calls } = setupFetch([
      { body: docGetResponse("old body") },
      { body: makeIssueQueryResponse([makeIssue()]) },
      { status: 409, body: { error: "commit moved" } }, // OCC rejects the PATCH
    ]);

    const err = await updateIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      id: "REEF-001",
      partial: {},
      content: "new body",
      expectedCommit: "commit-stale",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ConflictError);
    // The 409 fires before the row UPDATE, so only the rejected forward PATCH was
    // attempted — no row write, no compensating re-PATCH, nothing to diverge.
    expect(patchCalls(calls)).toHaveLength(1);
  });
});

describe("reorderBacklogIssues (REEF-129)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("applies a multi-row reorder as one atomic CASE update", async () => {
    const { calls } = setupFetch([{ body: ROW_UPDATE_OK }]);

    await reorderBacklogIssues({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      actor: "carol",
      assignments: [
        { id: "REEF-1", rank: 1000 },
        { id: "REEF-2", rank: 2000 },
        { id: "REEF-3", rank: 1500 },
      ],
    });

    // One SQL statement covers every row — no per-row write that could land
    // partially if a sibling failed.
    const sqlCalls = calls.filter((c) => c.url.includes("/sql"));
    expect(sqlCalls).toHaveLength(1);
    const sql = String(bodyOf(sqlCalls[0]).sql);
    expect(sql).toContain('SET "rank" = CASE "reef_id"');
    expect(sql).toContain("WHEN 'REEF-1' THEN 1000");
    expect(sql).toContain("WHEN 'REEF-3' THEN 1500");
    expect(sql).toContain(`WHERE "reef_id" IN ('REEF-1', 'REEF-2', 'REEF-3')`);
    // Scoped to the ACTIVE backlog (status + not archived) so a stale id that was
    // promoted, closed, or archived is skipped.
    expect(sql).toContain(`AND "status" = 'backlog' AND "archived_at" IS NULL`);
    // Same statement keeps updated_by consistent with the auto-bumped updated_at.
    expect(sql).toContain(
      `"meta" = jsonb_set("meta"::jsonb, '{last_editor}', to_jsonb('carol'::text))::json`,
    );
  });

  it("is a no-op write for an empty assignment set", async () => {
    const { calls } = setupFetch([]);
    await reorderBacklogIssues({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      actor: "carol",
      assignments: [],
    });
    expect(calls).toHaveLength(0);
  });
});

describe("born-correct backlog rank (REEF-176)", () => {
  afterEach(() => vi.unstubAllGlobals());

  // The exact tail subquery `backlogTailRankExpr()` emits — a new/demoted
  // backlog issue appends one RANK_STEP above the current active-backlog max.
  const TAIL_EXPR =
    `(SELECT COALESCE(MAX("rank"), 0) + 1000 FROM reef_issues ` +
    `WHERE "status" = 'backlog' AND "archived_at" IS NULL)`;

  function sqlStatements(calls: FetchCall[]): string[] {
    return calls
      .filter((c) => c.url.includes("/sql"))
      .map((c) => String(bodyOf(c).sql));
  }

  it("appends a new backlog issue to the manual-order tail on create", async () => {
    const { calls } = setupFetch([
      { body: putResponse("commit-1") }, // POST /documents
      { body: ROW_UPDATE_OK }, // insertIssueRow
    ]);
    await writeIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      issue: makeIssue({ status: "backlog" }),
      content: "",
    });
    const insert = sqlStatements(calls)[0];
    expect(insert).toContain("INSERT INTO reef_issues");
    expect(insert).toContain(TAIL_EXPR);
  });

  it("leaves rank NULL when the new issue is not in the backlog", async () => {
    const { calls } = setupFetch([
      { body: putResponse("commit-1") },
      { body: ROW_UPDATE_OK },
    ]);
    await writeIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      issue: makeIssue({ status: "todo" }),
      content: "",
    });
    expect(sqlStatements(calls)[0]).not.toContain("COALESCE(MAX");
  });

  it("appends to the tail and returns the assigned rank when an unranked issue is demoted into the backlog", async () => {
    const { calls } = setupFetch([
      { body: docGetResponse("body") }, // readIssue GET
      { body: makeIssueQueryResponse([makeIssue()]) }, // current: todo, unranked
      { body: ROW_UPDATE_OK }, // row UPDATE (rank = tail subquery)
      {
        body: makeIssueQueryResponse([
          makeIssue({ status: "backlog", rank: 33000 }),
        ]),
      }, // rank read-back
    ]);
    const res = await updateIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      id: "REEF-001",
      partial: { status: "backlog" },
    });
    const update = sqlStatements(calls).find((s) => s.startsWith("UPDATE"));
    expect(update).toContain(`"rank" = ${TAIL_EXPR}`);
    // The subquery-assigned rank is read back so the returned issue (and the
    // caches seeded from it) is not stale-null — the born-correct invariant.
    expect(res.issue.rank).toBe(33000);
    // A row status change does not touches the document.
    expect(patchCalls(calls)).toHaveLength(0);
  });

  it("keeps the existing rank when an already-ranked issue re-enters the backlog", async () => {
    const { calls } = setupFetch([
      { body: docGetResponse("body") },
      {
        body: makeIssueQueryResponse([
          makeIssue({ status: "todo", rank: 3000 }),
        ]),
      },
      { body: ROW_UPDATE_OK },
    ]);
    await updateIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      id: "REEF-001",
      partial: { status: "backlog" },
    });
    const update = sqlStatements(calls).find((s) => s.startsWith("UPDATE"));
    expect(update).not.toContain("COALESCE(MAX");
    expect(update).toContain('"rank" = 3000');
  });

  it("does not re-rank an edit made while already in the backlog", async () => {
    const { calls } = setupFetch([
      { body: docGetResponse("body") },
      {
        body: makeIssueQueryResponse([
          makeIssue({ status: "backlog", rank: 5000 }),
        ]),
      },
      { body: ROW_UPDATE_OK },
    ]);
    await updateIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      id: "REEF-001",
      partial: { priority: "high" },
    });
    const update = sqlStatements(calls).find((s) => s.startsWith("UPDATE"));
    expect(update).not.toContain("COALESCE(MAX");
    expect(update).toContain('"rank" = 5000');
  });
});
