import { describe, expect, it } from "vitest";
import {
  AkbApiError,
  AuthError,
  ConflictError,
  ISSUES_COLLECTION,
  ISSUE_ROW_COLUMNS,
  NotFoundError,
  SAMPLE_BODY,
  SAMPLE_ISSUE,
  SchemaValidationError,
  createAkbAdapter,
  makeAdapter,
  makeDocumentResponse,
  makeIssueRow,
  makePutResponse,
  makeSqlMutationResponse,
  makeSqlQueryResponse,
  readIssue,
  setupFetch,
  updateIssue,
  writeIssue,
} from "./akb.testSupport";
import type { IssueMetadata } from "./akb.testSupport";

describe("createAkbAdapter", () => {
  it("returns an adapter exposing a request function", () => {
    const adapter = makeAdapter();
    expect(typeof adapter.request).toBe("function");
  });

  it("two calls with the same jwt produce distinct request closures", () => {
    const a1 = createAkbAdapter({ baseUrl: "https://akb.test", jwt: "x" });
    const a2 = createAkbAdapter({ baseUrl: "https://akb.test", jwt: "x" });
    expect(a1.request).not.toBe(a2.request);
  });
});

// ── readIssue ────────────────────────────────────────────────────────────────

describe("readIssue", () => {
  it("joins the document body with the projection row", async () => {
    const { calls } = setupFetch([
      { body: makeDocumentResponse() }, // GET document
      { body: makeSqlQueryResponse([makeIssueRow()], ISSUE_ROW_COLUMNS) }, // row
    ]);
    const adapter = makeAdapter();
    const result = await readIssue({
      adapter,
      vault: "reef-sample",
      id: "REEF-001",
    });
    expect(result.issue.id).toBe("REEF-001");
    expect(result.issue.status).toBe("todo");
    expect(result.issue.labels).toEqual(["bug", "frontend"]);
    // Semantic actors come from the row's meta, not akb's auth principal.
    expect(result.issue.created_by).toBe("alice");
    expect(result.issue.updated_by).toBe("bob");
    expect(result.path).toBe("issues/reef-001-fix-the-login-flow.md");
    expect(result.content.trim()).toContain("Repro steps");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain(
      "/api/v1/documents/reef-sample/issues/reef-001.md",
    );
    expect(calls[1]?.url).toContain("/api/v1/tables/reef-sample/sql");
    const sqlBody = JSON.parse(calls[1]?.init?.body as string);
    expect(sqlBody.sql).toContain("FROM reef_issues");
    expect(sqlBody.sql).toContain("reef_id = 'REEF-001'");
    expect(
      (calls[0]?.init?.headers as Record<string, string>).Authorization,
    ).toBe("Bearer jwt.example.token");
  });

  it("round-trips last_status_change through the row's meta json", async () => {
    const issue: IssueMetadata = {
      ...SAMPLE_ISSUE,
      last_status_change: "2026-05-12T00:00:00.000Z",
    };
    setupFetch([
      { body: makeDocumentResponse() },
      { body: makeSqlQueryResponse([makeIssueRow(issue)], ISSUE_ROW_COLUMNS) },
    ]);
    const adapter = makeAdapter();
    const result = await readIssue({
      adapter,
      vault: "reef-sample",
      id: "REEF-001",
    });
    expect(result.issue.last_status_change).toBe("2026-05-12T00:00:00.000Z");
  });

  it("round-trips rich typed metadata columns and refs stored in meta json", async () => {
    const issue: IssueMetadata = {
      ...SAMPLE_ISSUE,
      issue_type: "bug",
      requester: "pm@example.com",
      reporter: "qa@example.com",
      start_date: "2026-05-20",
      due_date: "2026-05-22",
      milestone_id: "11111111-1111-4111-8111-111111111111",
      sprint_id: "22222222-2222-4222-8222-222222222222",
      release_id: "33333333-3333-4333-8333-333333333333",
      estimate_points: 5,
      severity: "critical",
      rank: 2048,
      closed_at: "2026-05-23T00:00:00.000Z",
      closed_reason: "completed",
      parent_id: "REEF-000",
      related_to: ["REEF-099"],
      external_refs: [
        {
          type: "github_issue",
          ref: "42",
          url: "https://github.com/acme/reef/issues/42",
        },
      ],
      implementation_refs: [
        {
          type: "pull_request",
          repo: "acme/reef",
          ref: "123",
          url: "https://github.com/acme/reef/pull/123",
        },
      ],
      watchers: ["pm@example.com"],
      reviewers: ["tech-lead"],
      qa_owner: "qa@example.com",
      custom_fields: { impact: "checkout" },
    };
    setupFetch([
      { body: makeDocumentResponse() },
      { body: makeSqlQueryResponse([makeIssueRow(issue)], ISSUE_ROW_COLUMNS) },
    ]);
    const adapter = makeAdapter();
    const result = await readIssue({
      adapter,
      vault: "reef-sample",
      id: "REEF-001",
    });

    expect(result.issue).toMatchObject({
      issue_type: "bug",
      requester: "pm@example.com",
      reporter: "qa@example.com",
      start_date: "2026-05-20",
      due_date: "2026-05-22",
      milestone_id: "11111111-1111-4111-8111-111111111111",
      sprint_id: "22222222-2222-4222-8222-222222222222",
      release_id: "33333333-3333-4333-8333-333333333333",
      estimate_points: 5,
      severity: "critical",
      rank: 2048,
      closed_at: "2026-05-23T00:00:00.000Z",
      closed_reason: "completed",
      parent_id: "REEF-000",
      related_to: ["REEF-099"],
      watchers: ["pm@example.com"],
      reviewers: ["tech-lead"],
      qa_owner: "qa@example.com",
      custom_fields: { impact: "checkout" },
    });
    expect(result.issue.external_refs?.[0]?.url).toBe(
      "https://github.com/acme/reef/issues/42",
    );
    expect(result.issue.implementation_refs?.[0]?.type).toBe("pull_request");
  });

  it("throws NotFoundError when the projection row is missing", async () => {
    setupFetch([
      { body: makeDocumentResponse() },
      { body: makeSqlQueryResponse([], ISSUE_ROW_COLUMNS) },
    ]);
    const adapter = makeAdapter();
    await expect(
      readIssue({ adapter, vault: "reef-sample", id: "REEF-001" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("translates a 404 document into NotFoundError (no row query)", async () => {
    const { calls } = setupFetch([
      { status: 404, body: { detail: "Document not found" } },
    ]);
    const adapter = makeAdapter();
    await expect(
      readIssue({ adapter, vault: "reef-sample", id: "REEF-999" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toHaveLength(1);
  });

  it("translates 401 into AuthError", async () => {
    setupFetch([{ status: 401, body: { detail: "Invalid token" } }]);
    const adapter = makeAdapter();
    await expect(
      readIssue({ adapter, vault: "reef-sample", id: "REEF-001" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("translates 422 into SchemaValidationError", async () => {
    setupFetch([
      { status: 422, body: { detail: [{ msg: "vault required" }] } },
    ]);
    const adapter = makeAdapter();
    await expect(
      readIssue({ adapter, vault: "", id: "REEF-001" }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
  });

  it("translates other 5xx into AkbApiError", async () => {
    setupFetch([{ status: 503, body: { detail: "Service unavailable" } }]);
    const adapter = makeAdapter();
    await expect(
      readIssue({ adapter, vault: "reef-sample", id: "REEF-001" }),
    ).rejects.toBeInstanceOf(AkbApiError);
  });
});

// ── writeIssue ───────────────────────────────────────────────────────────────

describe("writeIssue", () => {
  it("POSTs a plain-markdown document then INSERTs the projection row", async () => {
    const { calls } = setupFetch([
      { status: 201, body: makePutResponse() }, // POST document
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT row
    ]);
    const adapter = makeAdapter();
    const result = await writeIssue({
      adapter,
      vault: "reef-sample",
      issue: SAMPLE_ISSUE,
      content: SAMPLE_BODY,
    });
    expect(result.path).toBe("issues/reef-001-fix-the-login-flow.md");
    expect(result.commit_hash).toBe("abc1234");
    expect(calls).toHaveLength(2);

    const docCall = calls[0];
    expect(docCall?.init?.method).toBe("POST");
    const requestBody = JSON.parse(docCall?.init?.body as string);
    expect(requestBody.vault).toBe("reef-sample");
    expect(requestBody.collection).toBe(ISSUES_COLLECTION);
    expect(requestBody.title).toBe("REEF-001");
    expect(requestBody.summary).toBe("Fix the login flow");
    expect(requestBody.tags).toEqual(["bug", "frontend"]);
    expect(requestBody.depends_on).toEqual(["REEF-002"]);
    expect(requestBody.related_to).toEqual(["REEF-010"]);
    expect(requestBody.type).toBe("task");
    // Body is now plain markdown — no fenced reef frontmatter.
    expect(requestBody.content).toBe(SAMPLE_BODY);
    expect(requestBody.content).not.toContain("```yaml");

    const insertCall = calls[1];
    expect(insertCall?.url).toContain("/api/v1/tables/reef-sample/sql");
    const insertSql = JSON.parse(insertCall?.init?.body as string).sql;
    expect(insertSql).toContain("INSERT INTO reef_issues");
    expect(insertSql).toContain(
      "akb://reef-sample/doc/issues/reef-001-fix-the-login-flow.md",
    );
    expect(insertSql).toContain("'REEF-001'");
    expect(insertSql).toContain("'todo'");
    expect(insertSql).toContain("'high'");
    expect(insertSql).toContain('"issue_type"');
    expect(insertSql).toContain("'task'");
    // Semantic actors land in meta json, not akb-native columns.
    expect(insertSql).toContain('"author":"alice"');
    expect(insertSql).toContain('"last_editor":"bob"');
  });

  it("compensates by deleting the document when the row INSERT fails", async () => {
    const { calls } = setupFetch([
      { status: 201, body: makePutResponse() }, // POST document
      { status: 500, body: { detail: "insert blew up" } }, // INSERT row fails
      { status: 204, empty: true }, // compensating DELETE document
    ]);
    const adapter = makeAdapter();
    await expect(
      writeIssue({
        adapter,
        vault: "reef-sample",
        issue: SAMPLE_ISSUE,
        content: SAMPLE_BODY,
      }),
    ).rejects.toBeInstanceOf(AkbApiError);
    expect(calls).toHaveLength(3);
    expect(calls[2]?.init?.method).toBe("DELETE");
    expect(calls[2]?.url).toContain(
      "/api/v1/documents/reef-sample/issues/reef-001-fix-the-login-flow.md",
    );
  });

  it("propagates 409 as ConflictError", async () => {
    setupFetch([{ status: 409, body: { detail: "path already exists" } }]);
    const adapter = makeAdapter();
    await expect(
      writeIssue({ adapter, vault: "reef-sample", issue: SAMPLE_ISSUE }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// ── updateIssue ──────────────────────────────────────────────────────────────
