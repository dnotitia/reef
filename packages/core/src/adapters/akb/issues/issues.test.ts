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
import {
  claimIssueId,
  reorderBacklogIssues,
  updateIssue,
  writeIssue,
} from "./issues";

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

function makeMigrationIssue(over: Partial<IssueMetadata> = {}): IssueMetadata {
  return makeIssue({
    custom_fields: {
      jira_migration: {
        owner: { jira_cloud_id: "cloud-1", issue_id: "10001" },
      },
    },
    ...over,
  });
}

function makeReservation(issue: IssueMetadata): IssueMetadata {
  return {
    ...issue,
    archived_at: issue.updated_at,
    parent_id: undefined,
    depends_on: [],
    related_to: [],
    blocks: [],
    custom_fields: {
      ...issue.custom_fields,
      jira_migration: {
        ...((issue.custom_fields?.jira_migration as Record<string, unknown>) ??
          {}),
        reservation: true,
      },
    },
  };
}

function rowsForIssue(issue: IssueMetadata): unknown {
  const response = makeIssueQueryResponse([issue]) as {
    items: Array<Record<string, unknown>>;
  };
  response.items[0] = {
    ...response.items[0],
    document_uri: `akb://${VAULT}/coll/issues/doc/reef-001.md`,
    parent_id: issue.parent_id ?? null,
    related_to: issue.related_to ?? [],
    meta: {
      author: issue.created_by,
      last_editor: issue.updated_by,
      source: issue.source ?? null,
      last_status_change: issue.last_status_change ?? null,
      custom_fields: issue.custom_fields,
    },
  };
  return response;
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
    // A reorder changes `rank`, a typed row column absent from the doc's
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

  it("adopts an ambiguously acknowledged row update after exact readback", async () => {
    const recoveredIssue = makeIssue({
      updated_at: "2026-05-01T00:00:01.000Z",
    });
    const { calls } = setupFetch([
      { body: docGetResponse("old body") },
      { body: makeIssueQueryResponse([makeIssue()]) },
      { body: putResponse("commit-new") },
      { error: new TypeError("connection reset after commit") },
      {
        body: {
          ...(docGetResponse("new body") as Record<string, unknown>),
          current_commit: "commit-new",
        },
      },
      { body: makeIssueQueryResponse([recoveredIssue]) },
    ]);

    await expect(
      updateIssue({
        adapter: makeTestAkbAdapter(),
        vault: VAULT,
        id: "REEF-001",
        partial: {},
        content: "new body",
      }),
    ).resolves.toMatchObject({
      commit_hash: "commit-new",
      content: "new body",
      issue: { updated_at: "2026-05-01T00:00:01.000Z" },
    });
    expect(patchCalls(calls)).toHaveLength(1);
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

    // The precondition guards document-projected fields; a row-edit
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
    // The 409 fires before the row UPDATE, so the rejected forward PATCH was
    // attempted — no row write, no compensating re-PATCH, nothing to diverge.
    expect(patchCalls(calls)).toHaveLength(1);
  });

  it("rejects a stale row snapshot before overwriting row-only fields", async () => {
    const { calls } = setupFetch([
      { body: docGetResponse("body") },
      { body: makeIssueQueryResponse([makeIssue()]) },
      {
        body: {
          kind: "table_query",
          columns: ["reef_id"],
          items: [],
          total: 0,
        },
      },
    ]);

    await expect(
      updateIssue({
        adapter: makeTestAkbAdapter(),
        vault: VAULT,
        id: "REEF-001",
        partial: { priority: "high" },
        expectedUpdatedAt: "2026-05-01T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const updateSql = calls
      .filter((call) => call.url.includes("/sql"))
      .map((call) => String(bodyOf(call).sql))
      .at(-1);
    expect(updateSql).toContain("updated_at =");
    expect(updateSql).toContain("RETURNING reef_id");
    expect(updateSql?.slice(0, updateSql.indexOf(" WHERE "))).not.toContain(
      "updated_at",
    );
    expect(patchCalls(calls)).toHaveLength(0);
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

  it("atomically claims a migration issue id before creating its document", async () => {
    const issue = makeMigrationIssue({ status: "todo" });
    const { calls } = setupFetch([
      { body: ROW_UPDATE_OK }, // insert archived reservation
      { body: rowsForIssue(makeReservation(issue)) }, // claim readback
      { body: putResponse("commit-1") }, // POST /documents
      { body: rowsForIssue(makeReservation(issue)) }, // reservation readback
      { body: ROW_UPDATE_OK }, // promote reservation
      { body: rowsForIssue(issue) }, // finalized readback
    ]);
    await writeIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      issue,
      content: "migrated",
      claimFirst: true,
    });
    expect(calls[0]?.url).toContain("/sql");
    expect(String(bodyOf(calls[0]).sql)).toContain("INSERT INTO reef_issues");
    expect(String(bodyOf(calls[0]).sql)).toContain('"reservation":true');
    expect(String(bodyOf(calls[0]).sql)).toContain('"archived_at"');
    expect(calls[2]?.url).toContain("/documents");
    expect(String(bodyOf(calls[4]).sql)).toContain("UPDATE reef_issues");
    expect(String(bodyOf(calls[4]).sql)).toContain("archived_at IS NOT NULL");
    expect(String(bodyOf(calls[4]).sql)).toContain(
      "'reservation' = 'true'::jsonb",
    );
    expect(String(bodyOf(calls[4]).sql)).toContain(
      "updated_at = '2026-05-01T00:00:00.000Z'",
    );
  });

  it("claims a migration id without creating a document or relationships", async () => {
    const issue = makeIssue({
      parent_id: "REEF-099",
      depends_on: ["REEF-098"],
      custom_fields: {
        jira_migration: {
          owner: { jira_cloud_id: "cloud-1", issue_id: "10001" },
        },
      },
    });
    const reservation = makeReservation(issue);
    const { calls } = setupFetch([
      { body: ROW_UPDATE_OK },
      { body: rowsForIssue(reservation) },
    ]);
    await claimIssueId({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      issue,
    });
    expect(calls).toHaveLength(2);
    const sql = String(bodyOf(calls[0]).sql);
    expect(sql).toContain("INSERT INTO reef_issues");
    expect(sql).not.toContain("REEF-099");
    expect(sql).not.toContain("REEF-098");
    expect(sql).toContain('"archived_at"');
    expect(sql).toContain('"reservation":true');
  });

  it("normalizes a foreign-owner issue claim collision to ConflictError", async () => {
    const desired = makeIssue({
      custom_fields: {
        jira_migration: {
          owner: { jira_cloud_id: "cloud-1", issue_id: "10001" },
        },
      },
    });
    const foreign = makeIssue({
      custom_fields: {
        jira_migration: {
          owner: { jira_cloud_id: "cloud-1", issue_id: "different" },
        },
      },
    });
    const rows = makeIssueQueryResponse([foreign]) as {
      items: Array<Record<string, unknown>>;
    };
    rows.items[0] = {
      ...rows.items[0],
      document_uri: `akb://${VAULT}/coll/issues/doc/reef-001.md`,
      meta: {
        author: foreign.created_by,
        last_editor: foreign.updated_by,
        custom_fields: foreign.custom_fields,
      },
    };
    setupFetch([
      { status: 409, body: { error: "duplicate reef_id" } },
      { body: rows },
    ]);

    await expect(
      claimIssueId({
        adapter: makeTestAkbAdapter(),
        vault: VAULT,
        issue: desired,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects an owner atomically claimed under a different Reef id", async () => {
    const desired = makeMigrationIssue();
    const { calls } = setupFetch([
      {
        body: {
          kind: "table_query",
          columns: ["reef_id"],
          items: [],
          total: 0,
        },
      },
      { body: makeIssueQueryResponse([]) },
    ]);

    await expect(
      claimIssueId({
        adapter: makeTestAkbAdapter(),
        vault: VAULT,
        issue: desired,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    const claimSql = String(bodyOf(calls[0]).sql);
    expect(claimSql).toContain("pg_advisory_xact_lock");
    expect(claimSql).toContain("WHERE NOT EXISTS");
    expect(claimSql).toContain("jira_cloud_id");
    expect(claimSql).toContain("issue_id");
  });

  it("completes an exact owned row claim left without a document", async () => {
    const claimedIssue = makeIssue({
      status: "todo",
      custom_fields: {
        jira_migration: {
          owner: {
            jira_cloud_id: "cloud-1",
            issue_id: "10001",
          },
        },
      },
    });
    const reservation = makeReservation(claimedIssue);
    const claimedRows = rowsForIssue(reservation) as {
      items: Array<Record<string, unknown>>;
    };
    claimedRows.items[0] = {
      ...claimedRows.items[0],
      created_at: "2026-05-01T00:00:01.000Z",
    };
    const { calls } = setupFetch([
      { status: 409, body: { error: "duplicate reef_id" } },
      { body: claimedRows },
      { body: claimedRows },
      { status: 404, body: { error: "not found" } },
      { body: putResponse("commit-1") },
      { body: claimedRows },
      { body: ROW_UPDATE_OK },
      { body: rowsForIssue(claimedIssue) },
    ]);
    await expect(
      writeIssue({
        adapter: makeTestAkbAdapter(),
        vault: VAULT,
        issue: claimedIssue,
        content: "migrated",
        claimFirst: true,
      }),
    ).resolves.toMatchObject({ commit_hash: "commit-1" });
    expect(calls[3]?.init?.method).not.toBe("POST");
    expect(calls[4]?.init?.method).toBe("POST");
  });

  it("restores desired relationships while completing an owned claim", async () => {
    const owner = { jira_cloud_id: "cloud-1", issue_id: "10001" };
    const desiredIssue = makeIssue({
      status: "backlog",
      parent_id: "REEF-099",
      depends_on: ["REEF-098"],
      related_to: ["REEF-097"],
      blocks: ["REEF-096"],
      custom_fields: { jira_migration: { owner } },
    });
    const reservation = makeReservation(
      makeIssue({
        status: "backlog",
        rank: 4096,
        custom_fields: { jira_migration: { owner } },
      }),
    );
    const finalized = makeIssue({
      ...desiredIssue,
      status: "backlog",
      rank: 4096,
      updated_at: "2026-05-01T00:00:01.000Z",
    });
    const { calls } = setupFetch([
      { status: 409, body: { error: "duplicate reef_id" } },
      { body: rowsForIssue(reservation) },
      { body: rowsForIssue(reservation) },
      { status: 404, body: { error: "not found" } },
      { body: putResponse("commit-1") },
      { body: rowsForIssue(reservation) },
      { body: ROW_UPDATE_OK },
      { body: rowsForIssue(finalized) },
    ]);

    await expect(
      writeIssue({
        adapter: makeTestAkbAdapter(),
        vault: VAULT,
        issue: desiredIssue,
        content: "migrated",
        claimFirst: true,
      }),
    ).resolves.toMatchObject({ commit_hash: "commit-1" });

    const update = sqlStatements(calls).find((statement) =>
      statement.startsWith("UPDATE reef_issues"),
    );
    expect(update).toContain("REEF-098");
    expect(update).toContain("REEF-097");
    expect(update).toContain("REEF-096");
    expect(update).toContain("REEF-099");
    expect(update).toContain('"rank" = 4096');
    expect(calls[4]?.init?.method).toBe("POST");
  });

  it("preserves an owned row claim after an ambiguous document failure", async () => {
    const issue = makeMigrationIssue({ status: "todo" });
    const reservation = makeReservation(issue);
    const { calls } = setupFetch([
      { body: ROW_UPDATE_OK },
      { body: rowsForIssue(reservation) },
      { status: 500, body: { error: "response lost" } },
      { body: rowsForIssue(reservation) },
      { status: 404, body: { error: "not found" } },
    ]);
    await expect(
      writeIssue({
        adapter: makeTestAkbAdapter(),
        vault: VAULT,
        issue,
        content: "migrated",
        claimFirst: true,
      }),
    ).rejects.toBeInstanceOf(AkbApiError);
    expect(calls).toHaveLength(5);
  });

  it("adopts a committed document after its POST response is lost", async () => {
    const issue = makeMigrationIssue({ status: "todo" });
    const reservation = makeReservation(issue);
    const { calls } = setupFetch([
      { body: ROW_UPDATE_OK },
      { body: rowsForIssue(reservation) },
      { status: 500, body: { error: "response lost" } },
      { body: rowsForIssue(reservation) },
      { body: docGetResponse("migrated") },
      { body: rowsForIssue(reservation) },
      { body: ROW_UPDATE_OK },
      { body: rowsForIssue(issue) },
    ]);

    await expect(
      writeIssue({
        adapter: makeTestAkbAdapter(),
        vault: VAULT,
        issue,
        content: "migrated",
        claimFirst: true,
      }),
    ).resolves.toMatchObject({ commit_hash: "commit-old" });
    expect(
      calls.filter(
        (call) =>
          call.init?.method === "POST" &&
          call.url.endsWith("/api/v1/documents"),
      ),
    ).toHaveLength(1);
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
    // A row status change does not touch the document.
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
