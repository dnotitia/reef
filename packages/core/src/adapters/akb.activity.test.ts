import { describe, expect, it } from "vitest";
import {
  ACTIVITY_SUGGESTION_ROW_COLUMNS,
  AkbApiError,
  REEF_ACTIVITY_SUGGESTIONS_TABLE,
  SAMPLE_DRAFT_SUGGESTION,
  SAMPLE_STATUS_CHANGE_SUGGESTION,
  composeActivitySuggestionDocumentBody,
  listActivitySuggestions,
  makeActivitySuggestionRow,
  makeAdapter,
  makeDocumentResponse,
  makePutResponse,
  makeSqlMutationResponse,
  makeSqlQueryResponse,
  makeSqlRuntimeErrorResponse,
  readActivitySuggestion,
  setupFetch,
  updateActivitySuggestion,
  updateActivitySuggestionStatus,
  writeActivitySuggestion,
} from "./akb.testSupport";

describe("activity suggestions", () => {
  it("composes draft markdown with only the editable body", () => {
    const body = composeActivitySuggestionDocumentBody(SAMPLE_DRAFT_SUGGESTION);
    expect(body).toBe("A new endpoint was added without a rate limit.\n");
    expect(body).not.toContain("```yaml");
    expect(body).not.toContain("id:");
    expect(body).not.toContain("kind:");
  });

  it("composes status-change markdown with only the rationale", () => {
    const body = composeActivitySuggestionDocumentBody(
      SAMPLE_STATUS_CHANGE_SUGGESTION,
    );
    expect(body).toBe("PR #42 wiring the callback redirect was merged.\n");
    expect(body).not.toContain("```yaml");
    expect(body).not.toContain("kind:");
    expect(body).not.toContain("evidence:");
  });

  it("POSTs the markdown document and INSERTs the projection row", async () => {
    const { calls } = setupFetch([
      { status: 404, body: { detail: "missing" } },
      {
        status: 201,
        body: makePutResponse({
          path: "_reef/activity-inbox/reef-draft-0123456789abcdef.md",
        }),
      },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);
    const adapter = makeAdapter();
    const result = await writeActivitySuggestion({
      adapter,
      vault: "reef-sample",
      suggestion: SAMPLE_DRAFT_SUGGESTION,
    });
    expect(result.path).toBe(
      "_reef/activity-inbox/reef-draft-0123456789abcdef.md",
    );

    const docBody = JSON.parse(calls[1]?.init?.body as string);
    expect(docBody.collection).toBe("_reef/activity-inbox");
    expect(docBody.title).toBe("reef-draft-0123456789abcdef");
    expect(docBody.summary).toBe("Investigate missing rate limit");
    expect(docBody.tags).toEqual(["reef-activity-suggestion", "reef-ai-draft"]);
    expect(docBody.content).toBe(
      "A new endpoint was added without a rate limit.\n",
    );
    expect(docBody.content).not.toContain("```yaml");

    const insertSql = JSON.parse(calls[2]?.init?.body as string).sql;
    expect(insertSql).toContain("INSERT INTO reef_activity_suggestions");
    expect(insertSql).toContain("'reef-draft-0123456789abcdef'");
    expect(insertSql).toContain("'owner/reef:commit:abc123'");
  });

  it("compensates by deleting the document when the suggestion row INSERT fails", async () => {
    const { calls } = setupFetch([
      { status: 404, body: { detail: "missing" } },
      {
        status: 201,
        body: makePutResponse({
          path: "_reef/activity-inbox/reef-draft-0123456789abcdef.md",
        }),
      },
      { status: 500, body: { detail: "insert failed" } },
      { status: 204, empty: true },
    ]);
    const adapter = makeAdapter();
    await expect(
      writeActivitySuggestion({
        adapter,
        vault: "reef-sample",
        suggestion: SAMPLE_DRAFT_SUGGESTION,
      }),
    ).rejects.toBeInstanceOf(AkbApiError);
    expect(calls[3]?.init?.method).toBe("DELETE");
    expect(calls[3]?.url).toContain(
      "/api/v1/documents/reef-sample/_reef/activity-inbox/reef-draft-0123456789abcdef.md",
    );
  });

  it("lists and reads suggestions from the projection table", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            makeActivitySuggestionRow(SAMPLE_DRAFT_SUGGESTION),
            makeActivitySuggestionRow(SAMPLE_STATUS_CHANGE_SUGGESTION),
          ],
          ACTIVITY_SUGGESTION_ROW_COLUMNS,
        ),
      },
      {
        body: makeSqlQueryResponse(
          [makeActivitySuggestionRow(SAMPLE_STATUS_CHANGE_SUGGESTION)],
          ACTIVITY_SUGGESTION_ROW_COLUMNS,
        ),
      },
    ]);
    const adapter = makeAdapter();
    const list = await listActivitySuggestions({
      adapter,
      vault: "reef-sample",
      status: "pending",
    });
    expect(list.suggestions.map((s) => s.id)).toEqual([
      "reef-draft-0123456789abcdef",
      "reef-status-0123456789abcdef",
    ]);

    const read = await readActivitySuggestion({
      adapter,
      vault: "reef-sample",
      id: "reef-status-0123456789abcdef",
    });
    expect(read.suggestion).toEqual(SAMPLE_STATUS_CHANGE_SUGGESTION);
  });

  it("updates editable fields and reviewed status through document + row rewrite", async () => {
    const updated = {
      ...SAMPLE_DRAFT_SUGGESTION,
      proposal: {
        operation: "create" as const,
        create: {
          ...SAMPLE_DRAFT_SUGGESTION.proposal.create,
          fields: {
            ...SAMPLE_DRAFT_SUGGESTION.proposal.create.fields,
            title: "Updated title",
            labels: ["security", "backend"],
          },
        },
      },
    };
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [makeActivitySuggestionRow(SAMPLE_DRAFT_SUGGESTION)],
          ACTIVITY_SUGGESTION_ROW_COLUMNS,
        ),
      },
      {
        body: makeDocumentResponse({
          path: "_reef/activity-inbox/reef-draft-0123456789abcdef.md",
          title: "reef-draft-0123456789abcdef",
          type: "reference",
          content: composeActivitySuggestionDocumentBody(
            SAMPLE_DRAFT_SUGGESTION,
          ),
        }),
      },
      {
        body: makePutResponse({
          path: "_reef/activity-inbox/reef-draft-0123456789abcdef.md",
        }),
      },
      { body: makeSqlMutationResponse("UPDATE 1") },
      {
        body: makeSqlQueryResponse(
          [makeActivitySuggestionRow(updated)],
          ACTIVITY_SUGGESTION_ROW_COLUMNS,
        ),
      },
      {
        body: makeDocumentResponse({
          path: "_reef/activity-inbox/reef-draft-0123456789abcdef.md",
          title: "reef-draft-0123456789abcdef",
          type: "reference",
          content: composeActivitySuggestionDocumentBody(updated),
        }),
      },
      {
        body: makePutResponse({
          path: "_reef/activity-inbox/reef-draft-0123456789abcdef.md",
        }),
      },
      { body: makeSqlMutationResponse("UPDATE 1") },
    ]);
    const adapter = makeAdapter();
    const edited = await updateActivitySuggestion({
      adapter,
      vault: "reef-sample",
      id: SAMPLE_DRAFT_SUGGESTION.id,
      patch: { create: updated.proposal.create },
    });
    expect(edited.suggestion.kind).toBe("draft");
    expect(
      edited.suggestion.kind === "draft"
        ? edited.suggestion.proposal.create.fields.title
        : "",
    ).toBe("Updated title");

    const approved = await updateActivitySuggestionStatus({
      adapter,
      vault: "reef-sample",
      id: SAMPLE_DRAFT_SUGGESTION.id,
      status: "approved",
      reviewed_by: "pm",
      reviewed_at: "2026-05-13T00:00:00.000Z",
      approved_issue_id: "REEF-123",
    });
    expect(approved.suggestion.status).toBe("approved");
    expect(approved.suggestion.reviewed_by).toBe("pm");
    expect(
      approved.suggestion.kind === "draft"
        ? approved.suggestion.approved_issue_id
        : null,
    ).toBe("REEF-123");

    const patchCalls = calls.filter((call) => call.init?.method === "PATCH");
    expect(patchCalls).toHaveLength(2);
    const editPatchBody = JSON.parse(patchCalls[0]?.init?.body as string);
    expect(editPatchBody.content).toBe(
      "A new endpoint was added without a rate limit.\n",
    );
    expect(editPatchBody.content).not.toContain("```yaml");
    const approvePatchBody = JSON.parse(patchCalls[1]?.init?.body as string);
    expect(approvePatchBody.content).toBe(
      "A new endpoint was added without a rate limit.\n",
    );
    expect(approvePatchBody.content).not.toContain("approved_issue_id:");
  });

  it("returns an empty suggestion list when the projection table is missing", async () => {
    setupFetch([makeSqlRuntimeErrorResponse(REEF_ACTIVITY_SUGGESTIONS_TABLE)]);
    const adapter = makeAdapter();
    const result = await listActivitySuggestions({
      adapter,
      vault: "reef-sample",
    });
    expect(result.suggestions).toEqual([]);
  });
});

// ── Config (table-backed) ────────────────────────────────────────────────────

/** Wire shape returned by `POST /api/v1/tables/{vault}/sql` for SELECT. */
