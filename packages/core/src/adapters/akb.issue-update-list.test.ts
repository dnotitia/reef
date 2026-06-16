import { describe, expect, it } from "vitest";
import {
  AkbApiError,
  ISSUE_ROW_COLUMNS,
  NotFoundError,
  REEF_ISSUES_TABLE,
  SAMPLE_BODY,
  SAMPLE_ISSUE,
  deleteIssue,
  listIssues,
  makeAdapter,
  makeDocumentResponse,
  makeIssueRow,
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
