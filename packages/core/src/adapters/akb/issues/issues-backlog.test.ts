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

  function updateBody(calls: FetchCall[]): Record<string, unknown> {
    const call = calls.find(
      (candidate) =>
        candidate.url.includes("/sql") &&
        String(bodyOf(candidate).sql).startsWith("UPDATE"),
    );
    if (!call) throw new Error("expected an issue UPDATE request");
    return bodyOf(call);
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

  it("leaves a normal user-created backlog issue unranked until Manual reorder", async () => {
    const { calls } = setupFetch([
      { body: putResponse("commit-1") },
      { body: ROW_UPDATE_OK },
    ]);
    await writeIssue({
      adapter: makeTestAkbAdapter(),
      vault: VAULT,
      issue: makeIssue({ status: "backlog", source: "user:create_issue" }),
      content: "",
    });
    const insert = sqlStatements(calls)[0];
    expect(insert).not.toContain("COALESCE(MAX");
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
    expect(bodyOf(calls[0]).params).toEqual(
      expect.arrayContaining([expect.stringContaining('"reservation":true')]),
    );
    expect(String(bodyOf(calls[0]).sql)).toContain('"archived_at"');
    expect(calls[2]?.url).toContain("/documents");
    expect(String(bodyOf(calls[4]).sql)).toContain("UPDATE reef_issues");
    expect(String(bodyOf(calls[4]).sql)).toContain("archived_at IS NOT NULL");
    expect(String(bodyOf(calls[4]).sql)).toContain(
      "'reservation' = 'true'::jsonb",
    );
    expect(String(bodyOf(calls[4]).sql)).toContain("updated_at = $27");
    expect(bodyOf(calls[4]).params).toContain("2026-05-01T00:00:00.000Z");
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
    expect(bodyOf(calls[0]).params).toEqual(
      expect.arrayContaining([expect.stringContaining('"reservation":true')]),
    );
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
    const updateRequest = updateBody(calls);
    expect(update).toContain('"depends_on" =');
    expect(updateRequest.params).toEqual(
      expect.arrayContaining([
        JSON.stringify(["REEF-098"]),
        JSON.stringify(["REEF-097"]),
        JSON.stringify(["REEF-096"]),
        "REEF-099",
        4096,
      ]),
    );
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

  it("does not adopt a pre-existing document after a deterministic conflict", async () => {
    const issue = makeMigrationIssue({ status: "todo" });
    const reservation = makeReservation(issue);
    const { calls } = setupFetch([
      { body: ROW_UPDATE_OK },
      { body: rowsForIssue(reservation) },
      { status: 409, body: { error: "document already exists" } },
    ]);

    await expect(
      writeIssue({
        adapter: makeTestAkbAdapter(),
        vault: VAULT,
        issue,
        content: "migrated",
        claimFirst: true,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(calls).toHaveLength(3);
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
    expect(updateBody(calls).params).toContain(3000);
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
    expect(updateBody(calls).params).toContain(5000);
  });
});
