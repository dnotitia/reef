import { afterEach, describe, expect, it, vi } from "vitest";
import { AkbApiError, ConflictError } from "../../../errors";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import {
  type FetchCall,
  makeIssueQueryResponse,
  makeTestAkbAdapter,
  setupFetch,
} from "../../../test-support/akb/fetchMock";
import { mockOpenTelemetry } from "../../../test-support/akb/otelMock";
import {
  ALL_REEF_TABLES,
  makeListTablesResponse,
  makeSqlQueryResponse,
} from "../core/sqlTestSupport";
import { claimIssueId, updateIssue, writeIssue } from "./issues";

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
      mention_recipients: issue.mention_recipients ?? null,
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
      {
        body: {
          ...(docGetResponse("new body") as Record<string, unknown>),
          current_commit: "commit-new",
        },
      }, // ambiguous-write recovery document readback
      { body: makeIssueQueryResponse([makeIssue()]) }, // row did not commit
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
    expect(bodyOf(patches[1]).expected_commit).toBe("commit-new");
  });

  it("does not touch the document when a clean status edit's row UPDATE fails", async () => {
    const { calls } = setupFetch([
      { body: docGetResponse("body") }, // readIssue GET
      { body: makeIssueQueryResponse([makeIssue()]) }, // readIssue selectIssueRows
      { status: 500, body: { error: "sql boom" } }, // row UPDATE (fails)
      { body: docGetResponse("body") }, // ambiguous-write recovery readback
      { body: makeIssueQueryResponse([makeIssue()]) },
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
      {
        body: {
          ...(docGetResponse("new body") as Record<string, unknown>),
          current_commit: "commit-new",
        },
      },
      { body: makeIssueQueryResponse([makeIssue()]) },
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

  it("derives the mention projection from the current roster and appends a commit-bound delta", async () => {
    const current = makeIssue({
      assigned_to: undefined,
      mention_recipients: ["alice"],
    });
    const { calls } = setupFetch([
      { body: docGetResponse("old @alice") },
      { body: rowsForIssue(current) },
      {
        body: {
          members: [
            { username: "alice", role: "member" },
            { username: "bob", role: "member" },
          ],
        },
      },
      { body: putResponse("commit-mentions") },
      { body: ROW_UPDATE_OK },
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([{ id: "mention-event" }], ["id"]) },
    ]);

    const result = await updateIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      id: "REEF-001",
      partial: {},
      content: "new @bob @missing @bob",
    });

    expect(result.issue.mention_recipients).toEqual(["bob"]);
    const rowBody = bodyOf(calls[4]);
    expect(rowBody.sql).toContain('"meta" =');
    expect(rowBody.sql).not.toContain('"mention_recipients":["bob"]');
    expect(rowBody.params).toContain(
      JSON.stringify({
        author: "alice",
        last_editor: "alice",
        source: null,
        last_status_change: null,
        external_refs: null,
        implementation_refs: null,
        watchers: null,
        reviewers: null,
        qa_owner: null,
        custom_fields: null,
        mention_recipients: ["bob"],
      }),
    );
    const eventBody = bodyOf(calls[6]);
    expect(eventBody.sql).toContain("SELECT $1");
    expect(eventBody.params).toContain(
      "issue_body_mentions_change:commit-mentions",
    );
    expect(eventBody.params).toContain(
      JSON.stringify({
        recipients: ["bob"],
        added: ["bob"],
        removed: ["alice"],
        document_commit: "commit-mentions",
      }),
    );
  });

  it("does not append a mention event for a no-op recipient set", async () => {
    const current = makeIssue({
      assigned_to: undefined,
      mention_recipients: ["alice"],
    });
    const { calls } = setupFetch([
      { body: docGetResponse("old @alice") },
      { body: rowsForIssue(current) },
      { body: { members: [{ username: "alice", role: "member" }] } },
      { body: putResponse("commit-same-mentions") },
      { body: ROW_UPDATE_OK },
    ]);

    await updateIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      id: "REEF-001",
      partial: {},
      content: "old @alice",
    });

    expect(calls).toHaveLength(5);
    expect(calls.some((call) => call.url.includes("/members"))).toBe(true);
    expect(calls.some((call) => call.url.includes("/tables"))).toBe(true);
  });

  it("compensates both row and document when the mention delta append fails", async () => {
    const current = makeIssue({
      assigned_to: undefined,
      mention_recipients: ["alice"],
    });
    const { calls } = setupFetch([
      { body: docGetResponse("old @alice") },
      { body: rowsForIssue(current) },
      { body: { members: [{ username: "bob", role: "member" }] } },
      { body: putResponse("commit-failed-mentions") },
      { body: ROW_UPDATE_OK },
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { status: 500, body: { error: "activity insert failed" } },
      { body: ROW_UPDATE_OK },
      { body: putResponse("commit-restored") },
    ]);

    await expect(
      updateIssue({
        adapter: makeTestAkbAdapter(),
        vault: VAULT,
        id: "REEF-001",
        partial: {},
        content: "new @bob",
      }),
    ).rejects.toBeInstanceOf(AkbApiError);

    const patches = patchCalls(calls);
    expect(patches).toHaveLength(2);
    expect(bodyOf(patches[0]).content).toBe("new @bob");
    expect(bodyOf(patches[1]).content).toBe("old @alice");
    expect(bodyOf(patches[1]).expected_commit).toBe("commit-failed-mentions");
    const compensationBody = bodyOf(calls[7]);
    expect(compensationBody.sql).toContain('"meta" =');
    expect(compensationBody.params).toContain(
      JSON.stringify({
        author: "alice",
        last_editor: "alice",
        source: null,
        last_status_change: null,
        external_refs: null,
        implementation_refs: null,
        watchers: null,
        reviewers: null,
        qa_owner: null,
        custom_fields: null,
        mention_recipients: ["alice"],
      }),
    );
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
    expect(calls).toHaveLength(3);
  });
});
