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
});

describe("createComment", () => {
  it("inserts only reef_id/body/meta and returns the row via RETURNING", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) }, // ensureReefTables
      { body: makeSqlQueryResponse([{ reef_id: "REEF-062" }], ["reef_id"]) }, // parent issue exists
      {
        body: makeSqlQueryResponse(
          [
            makeCommentRow({
              id: "new-uuid",
              body: "hello $1 it's me",
              meta: {
                author: "alice",
                created_at: "2026-06-18T04:00:00.000Z",
                edited_at: null,
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
    );

    expect(comment).toMatchObject({
      id: "new-uuid",
      reef_id: "REEF-062",
      author: "alice",
      created_at: "2026-06-18T04:00:00.000Z",
      edited_at: null,
    });

    const sql = lastSql(calls[2]?.init?.body);
    expect(sql).toContain(`INSERT INTO ${REEF_COMMENTS_TABLE}`);
    // Declared columns are used; akb reserved/auto columns are excluded.
    expect(sql).toContain(`("reef_id", "body", "meta")`);
    expect(sql).not.toContain("created_by");
    expect(sql).toContain("RETURNING *");
    // SQL escaping: single-quote doubled, literal `$` preserved.
    expect(sql).toContain("'hello $1 it''s me'");
    // Semantic author lives in meta.
    expect(sql).toContain('"author":"alice"');
    expect(sql).toContain('"edited_at":null');
  });

  it("404s a comment on a non-existent issue (no orphan row)", async () => {
    setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) }, // ensureReefTables
      { body: makeSqlQueryResponse([], ["reef_id"]) }, // parent issue missing
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
