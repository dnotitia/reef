import { describe, expect, it } from "vitest";
import {
  ALL_REEF_TABLES,
  AkbApiError,
  ISSUE_ROW_COLUMNS,
  NotFoundError,
  REEF_ACTIVITY_TABLE,
  REEF_ISSUES_TABLE,
  SAMPLE_BODY,
  SAMPLE_ISSUE,
  deleteIssue,
  listIssues,
  makeAdapter,
  makeDocumentResponse,
  makeIssueRow,
  makeListTablesResponse,
  makePutResponse,
  makeSqlMutationResponse,
  makeSqlQueryResponse,
  makeSqlRuntimeErrorResponse,
  setupFetch,
  updateIssue,
  writeMultipleIssues,
} from "./akb.testSupport";

describe("updateIssue", () => {
  it("updates only the row for table-only fields (no document PATCH)", async () => {
    const { calls } = setupFetch([
      { body: makeDocumentResponse() }, // read: GET document
      { body: makeSqlQueryResponse([makeIssueRow()], ISSUE_ROW_COLUMNS) }, // read: row
      { body: makeSqlMutationResponse("UPDATE 1") }, // UPDATE row
    ]);
    const adapter = makeAdapter();
    const result = await updateIssue({
      adapter,
      vault: "reef-sample",
      id: "REEF-001",
      partial: { status: "in_progress", priority: "critical" },
    });
    // status/priority live just in the table → no git commit, carry the
    // document's existing commit hash through.
    expect(result.commit_hash).toBe("abc1234");
    expect(result.issue.status).toBe("in_progress");
    expect(calls).toHaveLength(3);
    expect(calls.some((c) => c.init?.method === "PATCH")).toBe(false);

    const updateCall = calls[2];
    expect(updateCall?.url).toContain("/api/v1/tables/reef-sample/sql");
    const updateSql = JSON.parse(updateCall?.init?.body as string).sql;
    expect(updateSql).toContain("UPDATE reef_issues SET");
    expect(updateSql).toContain(`"status" = 'in_progress'`);
    expect(updateSql).toContain(`"priority" = 'critical'`);
    expect(updateSql).toContain(`WHERE reef_id = 'REEF-001'`);
  });

  it("PATCHes the document and updates the row when the body changes", async () => {
    const { calls } = setupFetch([
      { body: makeDocumentResponse() }, // read: GET document
      { body: makeSqlQueryResponse([makeIssueRow()], ISSUE_ROW_COLUMNS) }, // read: row
      { body: makePutResponse({ commit_hash: "deadbeef" }) }, // PATCH document
      { body: makeSqlMutationResponse("UPDATE 1") }, // UPDATE row
    ]);
    const adapter = makeAdapter();
    const result = await updateIssue({
      adapter,
      vault: "reef-sample",
      id: "REEF-001",
      partial: { status: "done" },
      content: "rewritten body",
    });
    expect(result.commit_hash).toBe("deadbeef");
    expect(result.content).toBe("rewritten body");
    expect(calls).toHaveLength(4);

    const patchCall = calls[2];
    expect(patchCall?.init?.method).toBe("PATCH");
    const patchBody = JSON.parse(patchCall?.init?.body as string);
    expect(patchBody.content).toBe("rewritten body");
    expect(patchBody.content).not.toContain("```yaml");
    expect(patchBody.title).toBe("REEF-001");
    expect(patchBody.summary).toBe("Fix the login flow");
    expect(patchBody.tags).toEqual(["bug", "frontend"]);
    expect(patchCall?.url).toContain(
      "/api/v1/documents/reef-sample/issues/reef-001.md",
    );

    const updateSql = JSON.parse(calls[3]?.init?.body as string).sql;
    expect(updateSql).toContain(`"status" = 'done'`);
  });

  it("propagates NotFoundError from the read phase", async () => {
    setupFetch([{ status: 404, body: { detail: "missing" } }]);
    const adapter = makeAdapter();
    await expect(
      updateIssue({
        adapter,
        vault: "reef-sample",
        id: "REEF-999",
        partial: { status: "done" },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // REEF-063: a real status transition (one that records a fresh
  // last_status_change, as buildIssueUpdateMetadataPatch does on every web/agent
  // funnel) appends an immutable status_change event to reef_activity.
  it("appends a reef_activity event when the status transition records a fresh last_status_change", async () => {
    const { calls } = setupFetch([
      { body: makeDocumentResponse() }, // read: GET document
      { body: makeSqlQueryResponse([makeIssueRow()], ISSUE_ROW_COLUMNS) }, // read: row (status=todo)
      // UPDATE returns the committed prior status via the prev CTE.
      {
        body: makeSqlQueryResponse([{ from_status: "todo" }], ["from_status"]),
      },
      { body: makeListTablesResponse(ALL_REEF_TABLES) }, // append: ensureReefTables
      { body: makeSqlQueryResponse([], ["id"]) }, // append: idempotency probe
      { body: makeSqlMutationResponse("INSERT 0 1") }, // append: INSERT event
    ]);
    const adapter = makeAdapter();
    const result = await updateIssue({
      adapter,
      vault: "reef-sample",
      id: "REEF-001",
      partial: {
        status: "in_progress",
        last_status_change: "2026-06-18T10:00:00.000Z",
        updated_by: "carol",
      },
    });
    expect(result.issue.status).toBe("in_progress");
    expect(calls).toHaveLength(6);

    // The row UPDATE locks + captures the prior status atomically so the event's
    // `from` stays faithful under concurrent writes (REEF-063 concurrency fix).
    const updateSql = JSON.parse(calls[2]?.init?.body as string).sql;
    expect(updateSql).toContain(
      "WITH prev AS (SELECT reef_id, status AS from_status",
    );
    expect(updateSql).toContain("FOR UPDATE");
    expect(updateSql).toContain("UPDATE reef_issues SET");

    const insertSql = JSON.parse(calls[5]?.init?.body as string).sql;
    expect(insertSql).toContain(`INSERT INTO ${REEF_ACTIVITY_TABLE}`);
    expect(insertSql).toContain("'status_change'");
    expect(insertSql).toContain(
      "'status_change:todo->in_progress@2026-06-18T10:00:00.000Z'",
    );
    expect(insertSql).toContain('"from":"todo"');
    expect(insertSql).toContain('"to":"in_progress"');
    expect(insertSql).toContain('"actor":"carol"');
    expect(insertSql).toContain('"at":"2026-06-18T10:00:00.000Z"');
  });

  // Concurrency (REEF-063 / autoreview): the event's `from` is the status the
  // write actually overwrote, not the pre-read snapshot. Here the row was read
  // as `todo` but a racing write moved it to `in_progress` before this commit;
  // the prev CTE returns the committed `in_progress`, so the event is
  // in_progress→done, never a phantom todo→done.
  it("records the committed prior status as `from`, not the stale read snapshot", async () => {
    const { calls } = setupFetch([
      { body: makeDocumentResponse() }, // read: GET document
      { body: makeSqlQueryResponse([makeIssueRow()], ISSUE_ROW_COLUMNS) }, // read: row (stale status=todo)
      // The write commits over the racing in_progress; prev CTE returns it.
      {
        body: makeSqlQueryResponse(
          [{ from_status: "in_progress" }],
          ["from_status"],
        ),
      },
      { body: makeListTablesResponse(ALL_REEF_TABLES) }, // append: ensureReefTables
      { body: makeSqlQueryResponse([], ["id"]) }, // append: idempotency probe
      { body: makeSqlMutationResponse("INSERT 0 1") }, // append: INSERT event
    ]);
    const adapter = makeAdapter();
    await updateIssue({
      adapter,
      vault: "reef-sample",
      id: "REEF-001",
      partial: {
        status: "done",
        last_status_change: "2026-06-18T11:00:00.000Z",
        updated_by: "carol",
      },
    });

    const insertSql = JSON.parse(calls[5]?.init?.body as string).sql;
    expect(insertSql).toContain('"from":"in_progress"');
    expect(insertSql).toContain('"to":"done"');
    expect(insertSql).toContain(
      "'status_change:in_progress->done@2026-06-18T11:00:00.000Z'",
    );
  });

  // No phantom event when the committed prior already equals the new status (a
  // racing write got there first): from === to, so nothing is recorded.
  it("records no event when the committed prior status already equals the target", async () => {
    const { calls } = setupFetch([
      { body: makeDocumentResponse() }, // read: GET document
      { body: makeSqlQueryResponse([makeIssueRow()], ISSUE_ROW_COLUMNS) }, // read: row (stale status=todo)
      // A racing write already set in_progress; this update is a status no-op.
      {
        body: makeSqlQueryResponse(
          [{ from_status: "in_progress" }],
          ["from_status"],
        ),
      },
    ]);
    const adapter = makeAdapter();
    await updateIssue({
      adapter,
      vault: "reef-sample",
      id: "REEF-001",
      partial: {
        status: "in_progress",
        last_status_change: "2026-06-18T12:00:00.000Z",
        updated_by: "carol",
      },
    });
    // No ensureReefTables / probe / INSERT — from === to, the funnel did not fire.
    expect(calls).toHaveLength(3);
  });

  // A status flip that does NOT record a fresh last_status_change (a raw partial
  // bypassing buildIssueUpdateMetadataPatch — no canonical event time) records
  // no event: the UPDATE is the only write, exactly as before REEF-063.
  it("records no event when the status changes without a fresh last_status_change", async () => {
    const { calls } = setupFetch([
      { body: makeDocumentResponse() }, // read: GET document
      { body: makeSqlQueryResponse([makeIssueRow()], ISSUE_ROW_COLUMNS) }, // read: row
      // The prev CTE returns a real prior status, but without a fresh
      // last_status_change there is no canonical event time to key on.
      {
        body: makeSqlQueryResponse([{ from_status: "todo" }], ["from_status"]),
      },
    ]);
    const adapter = makeAdapter();
    const result = await updateIssue({
      adapter,
      vault: "reef-sample",
      id: "REEF-001",
      partial: { status: "in_progress" },
    });
    expect(result.issue.status).toBe("in_progress");
    // No ensureReefTables / probe / INSERT — the activity funnel did not fire.
    expect(calls).toHaveLength(3);
  });

  // A best-effort append failure must not fail the issue update: the status row
  // change already committed, and last_status_change stays the safety net (AC5).
  it("does not fail the update when the activity append errors", async () => {
    const { calls } = setupFetch([
      { body: makeDocumentResponse() }, // read: GET document
      { body: makeSqlQueryResponse([makeIssueRow()], ISSUE_ROW_COLUMNS) }, // read: row
      // UPDATE commits and returns the prior status, so the append is attempted.
      {
        body: makeSqlQueryResponse([{ from_status: "todo" }], ["from_status"]),
      },
      { status: 500, body: { detail: "list tables blew up" } }, // append: ensureReefTables fails
    ]);
    const adapter = makeAdapter();
    const result = await updateIssue({
      adapter,
      vault: "reef-sample",
      id: "REEF-001",
      partial: {
        status: "in_progress",
        last_status_change: "2026-06-18T10:00:00.000Z",
        updated_by: "carol",
      },
    });
    // The update succeeds despite the swallowed append error.
    expect(result.issue.status).toBe("in_progress");
    expect(calls).toHaveLength(4);
  });
});

// ── deleteIssue ──────────────────────────────────────────────────────────────

describe("deleteIssue", () => {
  it("reads the row, DELETEs it, then DELETEs the document", async () => {
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([makeIssueRow()], ISSUE_ROW_COLUMNS) }, // SELECT row
      { body: makeSqlMutationResponse("DELETE 1") }, // DELETE row
      { status: 204, empty: true }, // DELETE document
    ]);
    const adapter = makeAdapter();
    await deleteIssue({ adapter, vault: "reef-sample", id: "REEF-001" });
    expect(calls).toHaveLength(3);
    const deleteSql = JSON.parse(calls[1]?.init?.body as string).sql;
    expect(deleteSql).toContain("DELETE FROM reef_issues");
    expect(deleteSql).toContain(`WHERE reef_id = 'REEF-001'`);
    expect(calls[2]?.init?.method).toBe("DELETE");
    expect(calls[2]?.url).toContain(
      "/api/v1/documents/reef-sample/issues/reef-001.md",
    );
  });

  it("propagates a 404 document delete without restoring the row", async () => {
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([makeIssueRow()], ISSUE_ROW_COLUMNS) },
      { body: makeSqlMutationResponse("DELETE 1") },
      { status: 404, body: { detail: "missing" } }, // doc already gone
    ]);
    const adapter = makeAdapter();
    await expect(
      deleteIssue({ adapter, vault: "reef-sample", id: "REEF-001" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // No compensating re-INSERT — the deletion is effectively complete.
    expect(calls).toHaveLength(3);
  });

  it("restores the row when the document delete fails (non-404)", async () => {
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([makeIssueRow()], ISSUE_ROW_COLUMNS) }, // SELECT
      { body: makeSqlMutationResponse("DELETE 1") }, // DELETE row
      { status: 500, body: { detail: "doc delete blew up" } }, // DELETE doc fails
      { body: makeSqlMutationResponse("INSERT 0 1") }, // compensating re-INSERT
    ]);
    const adapter = makeAdapter();
    await expect(
      deleteIssue({ adapter, vault: "reef-sample", id: "REEF-001" }),
    ).rejects.toBeInstanceOf(AkbApiError);
    expect(calls).toHaveLength(4);
    const restoreSql = JSON.parse(calls[3]?.init?.body as string).sql;
    expect(restoreSql).toContain("INSERT INTO reef_issues");
    expect(restoreSql).toContain("'REEF-001'");
  });
});

// ── listIssues ───────────────────────────────────────────────────────────────

describe("listIssues", () => {
  it("returns issues from a single projection-table SELECT", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            makeIssueRow(),
            makeIssueRow(
              { ...SAMPLE_ISSUE, id: "REEF-002" },
              {
                reef_id: "REEF-002",
              },
            ),
          ],
          ISSUE_ROW_COLUMNS,
        ),
      },
    ]);
    const adapter = makeAdapter();
    const result = await listIssues({ adapter, vault: "reef-sample" });
    expect(result.issues).toHaveLength(2);
    expect(result.issues.map((i) => i.id)).toEqual(["REEF-001", "REEF-002"]);
    // No per-document body fetch — exactly one SQL round-trip.
    expect(calls).toHaveLength(1);
    const sql = JSON.parse(calls[0]?.init?.body as string).sql;
    expect(sql).toContain("SELECT * FROM reef_issues");
  });

  it("returns an empty list when the table does not exist yet", async () => {
    setupFetch([makeSqlRuntimeErrorResponse(REEF_ISSUES_TABLE)]);
    const adapter = makeAdapter();
    const result = await listIssues({ adapter, vault: "reef-sample" });
    expect(result.issues).toEqual([]);
  });

  it("skips a malformed row rather than failing the whole board", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            makeIssueRow(),
            makeIssueRow(SAMPLE_ISSUE, {
              reef_id: "REEF-BAD",
              status: "not-a-status",
            }),
          ],
          ISSUE_ROW_COLUMNS,
        ),
      },
    ]);
    const adapter = makeAdapter();
    const result = await listIssues({ adapter, vault: "reef-sample" });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.id).toBe("REEF-001");
  });
});

// ── writeMultipleIssues ──────────────────────────────────────────────────────

describe("writeMultipleIssues", () => {
  it("returns success entries for each write that succeeded", async () => {
    setupFetch([
      { status: 201, body: makePutResponse({ path: "issues/reef-001.md" }) },
      { body: makeSqlMutationResponse("INSERT 0 1") },
      { status: 201, body: makePutResponse({ path: "issues/reef-002.md" }) },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);
    const adapter = makeAdapter();
    const result = await writeMultipleIssues({
      adapter,
      vault: "reef-sample",
      issues: [
        { issue: SAMPLE_ISSUE, content: SAMPLE_BODY },
        {
          issue: { ...SAMPLE_ISSUE, id: "REEF-002", title: "Another" },
          content: "second body",
        },
      ],
    });
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.success)).toBe(true);
    expect(result.results[0]?.path).toBe("issues/reef-001.md");
    expect(result.results[1]?.path).toBe("issues/reef-002.md");
  });

  it("captures per-item failures without aborting", async () => {
    setupFetch([
      { status: 201, body: makePutResponse({ path: "issues/reef-101.md" }) },
      { body: makeSqlMutationResponse("INSERT 0 1") },
      { status: 422, body: { detail: "validation failed" } }, // item 2 doc POST
      { status: 201, body: makePutResponse({ path: "issues/reef-103.md" }) },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);
    const adapter = makeAdapter();
    const result = await writeMultipleIssues({
      adapter,
      vault: "reef-sample",
      issues: [
        { issue: { ...SAMPLE_ISSUE, id: "REEF-101" } },
        { issue: { ...SAMPLE_ISSUE, id: "REEF-102", title: "Another" } },
        { issue: { ...SAMPLE_ISSUE, id: "REEF-103", title: "Third" } },
      ],
    });
    expect(result.results.map((r) => r.success)).toEqual([true, false, true]);
    expect(result.results[1]?.error).toBeDefined();
  });
});

// ── Activity suggestions ────────────────────────────────────────────────────
