import { describe, expect, it } from "vitest";
import {
  ALL_REEF_TABLES,
  NotFoundError,
  REEF_COMMENTS_TABLE,
  createComment,
  listComments,
  makeAdapter,
  makeListTablesResponse,
  makeSqlQueryResponse,
  makeSqlRuntimeErrorResponse,
  setupFetch,
  updateComment,
} from "./akb.testSupport";

const COMMENT_ROW_COLUMNS = [
  "id",
  "reef_id",
  "body",
  "meta",
  "created_at",
  "updated_at",
  "created_by",
];

function makeCommentRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    reef_id: "REEF-062",
    body: "a comment",
    meta: {
      author: "alice",
      created_at: "2026-06-18T01:00:00.000Z",
      edited_at: null,
      parent_comment_id: null,
      thread_root_id: null,
    },
    created_at: "2026-06-18T01:00:00.123456+00",
    updated_at: "2026-06-18T01:00:00.123456+00",
    created_by: "akb-principal",
    ...overrides,
  };
}

function lastSql(body: unknown): string {
  return JSON.parse(body as string).sql as string;
}

describe("listComments", () => {
  it("projects author/created_at/edited_at from meta and orders oldest-first", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            makeCommentRow({
              id: "c1",
              body: "first",
              meta: {
                author: "alice",
                created_at: "2026-06-18T01:00:00.000Z",
                edited_at: null,
              },
            }),
            makeCommentRow({
              id: "c2",
              body: "second with `code`",
              meta: {
                author: "bob",
                created_at: "2026-06-18T02:00:00.000Z",
                edited_at: "2026-06-18T03:00:00.000Z",
              },
            }),
          ],
          COMMENT_ROW_COLUMNS,
        ),
      },
    ]);

    const comments = await listComments(
      makeAdapter(),
      "reef-sample",
      "REEF-062",
    );

    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({
      id: "c1",
      author: "alice",
      body: "first",
      edited_at: null,
    });
    expect(comments[1]).toMatchObject({
      author: "bob",
      edited_at: "2026-06-18T03:00:00.000Z",
    });
    const sql = lastSql(calls[0]?.init?.body);
    expect(sql).toContain(`FROM ${REEF_COMMENTS_TABLE}`);
    expect(sql).toContain("reef_id = 'REEF-062'");
    expect(sql).toContain("ORDER BY meta->>'created_at' ASC, id ASC");
  });

  it("returns an empty thread for an unprovisioned vault (no reconcile)", async () => {
    const { calls } = setupFetch([
      makeSqlRuntimeErrorResponse(REEF_COMMENTS_TABLE),
    ]);

    const comments = await listComments(
      makeAdapter(),
      "reef-sample",
      "REEF-062",
    );

    expect(comments).toEqual([]);
    // Read path absorbs the missing table without a follow-up provisioning call.
    expect(calls).toHaveLength(1);
  });

  it("skips a malformed row rather than failing the whole thread", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            makeCommentRow({ id: "c1" }),
            // missing meta.author → fails CommentMetaSchema
            makeCommentRow({
              id: "c2",
              meta: { created_at: "2026-06-18T02:00:00.000Z" },
            }),
          ],
          COMMENT_ROW_COLUMNS,
        ),
      },
    ]);

    const comments = await listComments(
      makeAdapter(),
      "reef-sample",
      "REEF-062",
    );

    expect(comments).toHaveLength(1);
    expect(comments[0]?.id).toBe("c1");
  });

  it("keeps legacy roots and valid replies while skipping broken thread chains", async () => {
    const rootId = "11111111-1111-4111-8111-111111111111";
    const replyId = "22222222-2222-4222-8222-222222222222";
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            makeCommentRow({ id: rootId }),
            makeCommentRow({
              id: replyId,
              meta: {
                author: "bob",
                created_at: "2026-06-18T02:00:00.000Z",
                edited_at: null,
                parent_comment_id: rootId,
                thread_root_id: rootId,
              },
            }),
            makeCommentRow({
              id: "33333333-3333-4333-8333-333333333333",
              meta: {
                author: "mallory",
                created_at: "2026-06-18T03:00:00.000Z",
                edited_at: null,
                parent_comment_id: replyId,
                thread_root_id: "44444444-4444-4444-8444-444444444444",
              },
            }),
          ],
          COMMENT_ROW_COLUMNS,
        ),
      },
    ]);

    const comments = await listComments(
      makeAdapter(),
      "reef-sample",
      "REEF-062",
    );
    expect(comments.map((comment) => comment.id)).toEqual([rootId, replyId]);
  });
});

describe("createComment", () => {
  it("inserts only reef_id/body/meta and returns the row via RETURNING", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) }, // ensureReefTables
      {
        body: makeSqlQueryResponse(
          [
            makeCommentRow({
              id: "new-uuid",
              body: "hello $1 it's me",
              meta: {
                author: "alice",
                created_at: "2026-06-18T04:00:00.000Z",
                edited_at: "2026-06-18T05:00:00.000Z",
              },
            }),
          ],
          COMMENT_ROW_COLUMNS,
        ),
      },
    ]);

    const comment = await createComment(
      makeAdapter(),
      "reef-sample",
      "REEF-062",
      "hello $1 it's me",
      "alice",
      undefined,
      {
        createdAt: "2026-06-18T04:00:00.000Z",
        editedAt: "2026-06-18T05:00:00.000Z",
        metadata: { jira_idempotency_key: "jira:comment:10001" },
      },
    );

    expect(comment).toMatchObject({
      id: "new-uuid",
      reef_id: "REEF-062",
      author: "alice",
      created_at: "2026-06-18T04:00:00.000Z",
      edited_at: "2026-06-18T05:00:00.000Z",
      parent_comment_id: null,
      thread_root_id: null,
    });

    const sql = lastSql(calls[1]?.init?.body);
    expect(sql).toContain(`INSERT INTO ${REEF_COMMENTS_TABLE}`);
    // Declared columns are used; akb reserved/auto columns are excluded.
    expect(sql).toContain(`("reef_id", "body", "meta")`);
    expect(sql).toContain("WITH target_issue AS");
    expect(sql).toContain("WHERE reef_id = 'REEF-062' LIMIT 1");
    expect(sql).toContain("SELECT 'REEF-062', 'hello $1 it''s me'");
    expect(sql).not.toContain("created_by");
    expect(sql).toContain("RETURNING *");
    // SQL escaping: single-quote doubled, literal `$` preserved.
    expect(sql).toContain("'hello $1 it''s me'");
    // Semantic author lives in meta.
    expect(sql).toContain('"author":"alice"');
    expect(sql).toContain('"edited_at":"2026-06-18T05:00:00.000Z"');
    expect(sql).toContain('"jira_idempotency_key":"jira:comment:10001"');
  });

  it("404s a comment on a non-existent issue (no orphan row)", async () => {
    setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) }, // ensureReefTables
      { body: makeSqlQueryResponse([], COMMENT_ROW_COLUMNS) },
    ]);

    await expect(
      createComment(
        makeAdapter(),
        "reef-sample",
        "REEF-999",
        "orphan",
        "alice",
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("creates a root reply with direct parent and root in one conditional statement", async () => {
    const rootId = "11111111-1111-4111-8111-111111111111";
    const replyId = "22222222-2222-4222-8222-222222222222";
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      {
        body: makeSqlQueryResponse(
          [
            makeCommentRow({
              id: replyId,
              body: "reply",
              meta: {
                author: "alice",
                created_at: "2026-06-18T04:00:00.000Z",
                edited_at: null,
                parent_comment_id: rootId,
                thread_root_id: rootId,
              },
            }),
          ],
          COMMENT_ROW_COLUMNS,
        ),
      },
    ]);

    await expect(
      createComment(
        makeAdapter(),
        "reef-sample",
        "REEF-062",
        "reply",
        "alice",
        rootId,
        {
          createdAt: "2026-06-18T04:00:00.000Z",
          editedAt: null,
          metadata: { jira_idempotency_key: "jira:reply:10002" },
        },
      ),
    ).resolves.toMatchObject({
      id: replyId,
      parent_comment_id: rootId,
      thread_root_id: rootId,
    });

    const sql = lastSql(calls[1]?.init?.body);
    expect(sql).toContain("direct_parent AS");
    expect(sql).toContain("valid_reply AS");
    expect(sql).toContain("CROSS JOIN valid_reply");
    expect(sql).toContain("WITH RECURSIVE target_issue");
    expect(sql).toContain("WHERE reef_id = 'REEF-062' LIMIT 1");
    expect(sql).toContain("parent_chain AS");
    expect(sql).toContain('"jira_idempotency_key":"jira:reply:10002"');
    expect(sql.match(/INSERT INTO reef_comments/g)).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("returns the same parent-not-found error for missing, cross-issue, or malformed parents", async () => {
    setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([], COMMENT_ROW_COLUMNS) },
    ]);

    const error = await createComment(
      makeAdapter(),
      "reef-sample",
      "REEF-062",
      "reply",
      "alice",
      "11111111-1111-4111-8111-111111111111",
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).context.resourceKind).toBe("commentParent");
  });
});

describe("updateComment", () => {
  it("edits the body, stamps meta.edited_at, and guards on author ownership", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) }, // ensureReefTables
      {
        body: makeSqlQueryResponse(
          [
            makeCommentRow({
              id: "c1",
              body: "edited body",
              meta: {
                author: "alice",
                created_at: "2026-06-18T01:00:00.000Z",
                edited_at: "2026-06-18T05:00:00.000Z",
              },
            }),
          ],
          COMMENT_ROW_COLUMNS,
        ),
      },
    ]);

    const comment = await updateComment(
      makeAdapter(),
      "reef-sample",
      "REEF-062",
      "c1",
      "edited body",
      "alice",
    );

    expect(comment).toMatchObject({
      id: "c1",
      body: "edited body",
      edited_at: "2026-06-18T05:00:00.000Z",
    });

    const sql = lastSql(calls[1]?.init?.body);
    expect(sql).toContain(`UPDATE ${REEF_COMMENTS_TABLE}`);
    expect(sql).toContain("jsonb_set(meta::jsonb, '{edited_at}'");
    expect(sql).toContain("WHERE id = 'c1'");
    // Scoped to the parent issue named in the URL.
    expect(sql).toContain("reef_id = 'REEF-062'");
    // Ownership guard: the author's own row matches.
    expect(sql).toContain("meta->>'author' = 'alice'");
    expect(sql).toContain("RETURNING *");
  });

  it("raises NotFound when no row matches (missing comment or not the author)", async () => {
    setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([], COMMENT_ROW_COLUMNS) }, // 0 rows updated
    ]);

    await expect(
      updateComment(
        makeAdapter(),
        "reef-sample",
        "REEF-062",
        "c1",
        "x",
        "mallory",
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
