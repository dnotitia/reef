import { describe, expect, it } from "vitest";
import { buildSubscriptionKey } from "../../../schemas/notifications";
import {
  ALL_REEF_TABLES,
  NotFoundError,
  REEF_COMMENTS_TABLE,
  SchemaValidationError,
  createComment,
  listComments,
  makeAdapter,
  makeListTablesResponse,
  makeSqlQueryResponse,
  makeSqlRuntimeErrorResponse,
  reconcileJiraImportedComment,
  setupFetch,
  updateComment,
} from "../core/testSupport";

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

function commenterSubscriptionRow(subscriber: string): Record<string, unknown> {
  return {
    id: "018f47a4-8e3b-7f62-a3d2-9876543210ab",
    subscription_key: buildSubscriptionKey({
      reefId: "REEF-062",
      subscriber,
      source: "commenter",
    }),
    reef_id: "REEF-062",
    subscriber,
    source: "commenter",
    status: "active",
    subscribed_at: "2026-07-30T00:00:00.000Z",
    meta: null,
  };
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

  it("treats malformed persisted mention projections as empty on read", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            makeCommentRow({
              body: "hello @alice",
              meta: {
                author: "alice",
                created_at: "2026-06-18T01:00:00.000Z",
                edited_at: null,
                mention_recipients: { malformed: true },
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

    expect(comments).toHaveLength(1);
    expect(comments[0]?.mention_recipients).toEqual([]);
  });
});

describe("createComment", () => {
  it("validates mentions against the current roster and persists a deduped projection", async () => {
    const { calls } = setupFetch([
      {
        body: {
          members: [
            { username: "Alice Smith", role: "member" },
            { username: "alice", role: "member" },
          ],
        },
      },
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      {
        body: makeSqlQueryResponse(
          [
            makeCommentRow({
              id: "new-mention-uuid",
              body: "hello @{Alice Smith} @alice and @alice",
              meta: {
                author: "alice",
                created_at: "2026-06-18T04:00:00.000Z",
                edited_at: null,
                mention_recipients: ["Alice Smith", "alice"],
              },
            }),
          ],
          COMMENT_ROW_COLUMNS,
        ),
      },
      {
        body: makeSqlQueryResponse([commenterSubscriptionRow("alice")], ["id"]),
      },
    ]);

    const comment = await createComment(
      makeAdapter(),
      "reef-sample",
      "REEF-062",
      "hello @{Alice Smith} @alice and @alice",
      "alice",
      undefined,
      {
        createdAt: "2026-06-18T04:00:00.000Z",
        editedAt: null,
      },
    );

    expect(comment.mention_recipients).toEqual(["Alice Smith", "alice"]);
    const sql = lastSql(calls[2]?.init?.body);
    expect(sql).toContain('"mention_recipients":["Alice Smith","alice"]');
  });

  it("fails closed before provisioning or inserting when a mention is unresolved", async () => {
    const { calls } = setupFetch([
      {
        body: {
          members: [{ username: "alice", role: "member" }],
        },
      },
    ]);

    await expect(
      createComment(
        makeAdapter(),
        "reef-sample",
        "REEF-062",
        "hello @missing",
        "alice",
      ),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/api/v1/vaults/reef-sample/members");
  });

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
      {
        body: makeSqlQueryResponse([commenterSubscriptionRow("alice")], ["id"]),
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
    expect(sql).toContain("target_issue AS");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("jira_idempotency_key");
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
      {
        body: makeSqlQueryResponse([commenterSubscriptionRow("alice")], ["id"]),
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
    expect(sql).toContain("WITH RECURSIVE");
    expect(sql).toContain("target_issue AS");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("WHERE reef_id = 'REEF-062' LIMIT 1");
    expect(sql).toContain("parent_chain AS");
    expect(sql).toContain(
      "chain_parent.id::text = parent_chain.meta->>'parent_comment_id'",
    );
    expect(sql).toContain("root_comment.id::text = reply_target.root_id");
    expect(sql).toContain("jsonb_build_object");
    expect(sql).not.toMatch(/\bjson_build_object\b/u);
    expect(sql).toContain('"jira_idempotency_key":"jira:reply:10002"');
    expect(sql.match(/INSERT INTO reef_comments/g)).toHaveLength(1);
    expect(calls).toHaveLength(3);
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
  it("replaces the persisted mention projection on edit", async () => {
    const { calls } = setupFetch([
      {
        body: {
          members: [{ username: "alice", role: "member" }],
        },
      },
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      {
        body: makeSqlQueryResponse(
          [
            makeCommentRow({
              id: "c1",
              body: "edited @alice",
              meta: {
                author: "alice",
                created_at: "2026-06-18T01:00:00.000Z",
                edited_at: "2026-06-18T05:00:00.000Z",
                mention_recipients: ["alice"],
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
      "edited @alice",
      "alice",
    );

    expect(comment.mention_recipients).toEqual(["alice"]);
    expect(lastSql(calls[2]?.init?.body)).toContain(
      '"mention_recipients":["alice"]',
    );
  });

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

  it("atomically preserves imported timestamps and idempotency metadata", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      {
        body: makeSqlQueryResponse(
          [
            makeCommentRow({
              id: "c1",
              body: "imported edit",
              meta: {
                author: "alice",
                created_at: "2020-01-01T00:00:00.000Z",
                edited_at: "2020-01-02T00:00:00.000Z",
              },
            }),
          ],
          COMMENT_ROW_COLUMNS,
        ),
      },
    ]);

    await updateComment(
      makeAdapter(),
      "reef-sample",
      "REEF-062",
      "c1",
      "imported edit",
      "alice",
      {
        createdAt: "2020-01-01T00:00:00.000Z",
        editedAt: "2020-01-02T00:00:00.000Z",
        metadata: { jira_idempotency_key: "jira:comment:10001" },
      },
    );

    const sql = lastSql(calls[1]?.init?.body);
    expect(sql).toContain('"created_at":"2020-01-01T00:00:00.000Z"');
    expect(sql).toContain('"edited_at":"2020-01-02T00:00:00.000Z"');
    expect(sql).toContain('"jira_idempotency_key":"jira:comment:10001"');
    expect(sql).toContain("meta::jsonb ||");
  });
});

describe("reconcileJiraImportedComment", () => {
  const jiraKey = "comment:cloud-1:15263:15578";

  it("repairs a Jira-owned comment author in place", async () => {
    const parentId = "22222222-2222-4222-8222-222222222222";
    const rootId = "33333333-3333-4333-8333-333333333333";
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      {
        body: makeSqlQueryResponse(
          [
            makeCommentRow({
              id: "c1",
              body: "imported comment",
              meta: {
                author: "hongchan",
                created_at: "2025-05-27T21:43:43.262+09:00",
                edited_at: null,
                parent_comment_id: parentId,
                thread_root_id: rootId,
                jira_idempotency_key: jiraKey,
              },
            }),
          ],
          COMMENT_ROW_COLUMNS,
        ),
      },
    ]);

    await expect(
      reconcileJiraImportedComment(makeAdapter(), "reef-sample", {
        commentId: "c1",
        reefId: "REEF-062",
        idempotencyKey: jiraKey,
        body: "imported comment",
        author: "hongchan",
        createdAt: "2025-05-27T21:43:43.262+09:00",
        editedAt: null,
      }),
    ).resolves.toMatchObject({
      id: "c1",
      author: "hongchan",
      parent_comment_id: parentId,
      thread_root_id: rootId,
    });

    const sql = lastSql(calls[1]?.init?.body);
    expect(sql).toContain(`UPDATE ${REEF_COMMENTS_TABLE}`);
    expect(sql).toContain('"author":"hongchan"');
    expect(sql).toContain(`meta->>'jira_idempotency_key' = '${jiraKey}'`);
    expect(sql).toContain("RETURNING *");
    expect(sql).not.toContain("created_by =");
    expect(sql).not.toContain("created_at =");
    expect(sql).not.toContain("parent_comment_id");
    expect(sql).not.toContain("thread_root_id");
  });

  it("revalidates and replaces the mention projection during Jira repair", async () => {
    const { calls } = setupFetch([
      {
        body: {
          members: [{ username: "Alice Smith", role: "member" }],
        },
      },
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      {
        body: makeSqlQueryResponse(
          [
            makeCommentRow({
              id: "c1",
              body: "hello @{Alice Smith}",
              meta: {
                author: "hongchan",
                created_at: "2025-05-27T21:43:43.262+09:00",
                edited_at: null,
                mention_recipients: ["Alice Smith"],
                jira_idempotency_key: jiraKey,
              },
            }),
          ],
          COMMENT_ROW_COLUMNS,
        ),
      },
    ]);

    await expect(
      reconcileJiraImportedComment(makeAdapter(), "reef-sample", {
        commentId: "c1",
        reefId: "REEF-062",
        idempotencyKey: jiraKey,
        body: "hello @{Alice Smith}",
        author: "hongchan",
        createdAt: "2025-05-27T21:43:43.262+09:00",
        editedAt: null,
      }),
    ).resolves.toMatchObject({
      mention_recipients: ["Alice Smith"],
    });

    expect(lastSql(calls[2]?.init?.body)).toContain(
      '"mention_recipients":["Alice Smith"]',
    );
  });

  it("rejects an unresolved mention before touching the Jira-owned row", async () => {
    const { calls } = setupFetch([
      {
        body: {
          members: [{ username: "alice", role: "member" }],
        },
      },
    ]);

    await expect(
      reconcileJiraImportedComment(makeAdapter(), "reef-sample", {
        commentId: "c1",
        reefId: "REEF-062",
        idempotencyKey: jiraKey,
        body: "hello @missing",
        author: "hongchan",
        createdAt: "2025-05-27T21:43:43.262+09:00",
        editedAt: null,
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(calls).toHaveLength(1);
  });

  it("rejects non-Jira keys before I/O", async () => {
    const { calls } = setupFetch([]);

    await expect(
      reconcileJiraImportedComment(makeAdapter(), "reef-sample", {
        commentId: "c1",
        reefId: "REEF-062",
        idempotencyKey: "manual-comment",
        body: "comment",
        author: "alice",
        createdAt: "2025-05-27T21:43:43.262+09:00",
        editedAt: null,
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(calls).toHaveLength(0);
  });
});
