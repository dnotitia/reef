import { ZodError } from "zod";
import { NotFoundError, SchemaValidationError } from "../../../errors";
import {
  type Comment,
  CommentMetaSchema,
  CommentSchema,
} from "../../../schemas/issues/comment";
import {
  type AkbAdapter,
  REEF_COMMENTS_TABLE,
  REEF_ISSUES_TABLE,
  decodeSettingsValue,
  ensureReefTables,
  isMissingTableError,
  quoteIdent,
  quoteJson,
  quoteText,
  runSql,
  tableRef,
  withSpan,
} from "../core/shared";

/**
 * Map a `reef_comments` row to a Comment. The reef-semantic author and the
 * created/edited timestamps are projected from the row's `meta` json — NOT from
 * akb's auto `created_by`/`created_at` columns (REEF-125): those are the akb
 * auth principal and akb bookkeeping, not reef's source of truth.
 */
function rowToComment(row: Record<string, unknown>): Comment {
  try {
    const meta = CommentMetaSchema.parse(decodeSettingsValue(row.meta) ?? {});
    return CommentSchema.parse({
      id: row.id,
      reef_id: row.reef_id,
      body: row.body,
      author: meta.author,
      created_at: meta.created_at,
      edited_at: meta.edited_at,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      throw new SchemaValidationError({
        issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    throw new SchemaValidationError({
      issues: ["Comment row validation failed"],
    });
  }
}

/**
 * List an issue's comments oldest-first. Orders by the semantic `meta.created_at`
 * (ISO-8601 sorts lexically), with the akb uuid `id` as a stable tiebreak.
 *
 * Read-path resilience: an unprovisioned vault (no `reef_comments` table) reads
 * as an empty thread WITHOUT reconciling — a read never provisions (REEF-125
 * AC9). A single malformed row is skipped rather than blanking the whole thread.
 */
export async function listComments(
  adapter: AkbAdapter,
  vault: string,
  reefId: string,
): Promise<Comment[]> {
  return withSpan(
    "akb.list_comments",
    { vault, reef_id: reefId },
    async (span) => {
      let rows: Record<string, unknown>[];
      try {
        const res = await runSql(
          adapter,
          vault,
          `SELECT * FROM ${tableRef(REEF_COMMENTS_TABLE)} WHERE reef_id = ${quoteText(
            reefId,
            "comment reef_id",
          )} ORDER BY meta->>'created_at' ASC, id ASC`,
        );
        rows = res.kind === "table_query" ? res.items : [];
      } catch (err) {
        if (isMissingTableError(err)) {
          span.setAttribute("table_exists", false);
          return [];
        }
        throw err;
      }
      const comments: Comment[] = [];
      for (const row of rows) {
        try {
          comments.push(rowToComment(row));
        } catch {
          // Skip a malformed comment row rather than failing the whole thread.
        }
      }
      span.setAttribute("comment_count", comments.length);
      return comments;
    },
  );
}

/**
 * Create a comment on an issue and return it in a single statement. The INSERT
 * is wrapped in a data-modifying CTE so the akb-assigned uuid `id` and the
 * row's persisted state come back via RETURNING with no separate read-back
 * (mirrors `insertAndReadPlanningRow`). `author` is the session actor resolved
 * by the route — never client-supplied — and is stored in `meta` (REEF-125).
 *
 * Provisions `reef_comments` lazily via `ensureReefTables` so the first comment
 * on a vault that predates the table self-heals instead of 500-ing (REEF-125
 * write-path gating).
 */
export async function createComment(
  adapter: AkbAdapter,
  vault: string,
  reefId: string,
  body: string,
  author: string,
): Promise<Comment> {
  return withSpan(
    "akb.create_comment",
    { vault, reef_id: reefId },
    async () => {
      await ensureReefTables({ adapter, vault });
      // Refuse to attach a comment to a non-existent issue. Issue ids are
      // predictable, so an orphan row would otherwise surface on a future issue
      // that reuses the id (autoreview P2). The reef_issues row is the board's
      // source of truth for an issue's existence.
      const parent = await runSql(
        adapter,
        vault,
        `SELECT reef_id FROM ${tableRef(REEF_ISSUES_TABLE)} WHERE reef_id = ${quoteText(
          reefId,
          "comment reef_id",
        )} LIMIT 1`,
      );
      if (parent.kind !== "table_query" || parent.items.length === 0) {
        throw new NotFoundError({ resource: `issue ${reefId}` });
      }
      const meta = {
        author,
        created_at: new Date().toISOString(),
        edited_at: null,
      };
      const fields: Array<[string, string]> = [
        ["reef_id", quoteText(reefId, "comment reef_id")],
        ["body", quoteText(body, "comment body")],
        ["meta", quoteJson(meta)],
      ];
      const columns = fields
        .map(([c]) => c)
        .map(quoteIdent)
        .join(", ");
      const values = fields.map(([, v]) => v).join(", ");
      const res = await runSql(
        adapter,
        vault,
        `WITH ins AS (INSERT INTO ${tableRef(
          REEF_COMMENTS_TABLE,
        )} (${columns}) VALUES (${values}) RETURNING *) SELECT * FROM ins`,
      );
      const row = res.kind === "table_query" ? res.items[0] : undefined;
      if (!row) {
        throw new SchemaValidationError({
          issues: ["comment row not returned after insert"],
        });
      }
      return rowToComment(row);
    },
  );
}

/**
 * Edit a comment's body. Ownership is enforced in the WHERE clause: the row is
 * updated only when `meta.author` equals the acting `editor`, so a non-author
 * edit (or a missing comment) matches zero rows and surfaces as NotFound. This
 * is atomic and last-write-wins safe — there is no read-then-write race.
 *
 * Preserves `meta.author`/`meta.created_at` and sets `meta.edited_at` to now
 * (the "edited" signal, REEF-062 AC2). The mutation rides a data-modifying CTE
 * so the updated row returns via RETURNING.
 *
 * Scoped to `reefId` as well as `commentId`: the WHERE binds the comment's
 * parent issue, so editing a comment through a URL that names a different issue
 * matches zero rows and 404s instead of mutating another issue's thread
 * (autoreview P2).
 */
export async function updateComment(
  adapter: AkbAdapter,
  vault: string,
  reefId: string,
  commentId: string,
  body: string,
  editor: string,
): Promise<Comment> {
  return withSpan(
    "akb.update_comment",
    { vault, reef_id: reefId, comment_id: commentId },
    async () => {
      await ensureReefTables({ adapter, vault });
      const editedAt = new Date().toISOString();
      const res = await runSql(
        adapter,
        vault,
        `WITH upd AS (UPDATE ${tableRef(
          REEF_COMMENTS_TABLE,
        )} SET body = ${quoteText(
          body,
          "comment body",
        )}, meta = jsonb_set(meta::jsonb, '{edited_at}', to_jsonb(${quoteText(
          editedAt,
          "comment edited_at",
        )}::text))::json WHERE id = ${quoteText(
          commentId,
          "comment id",
        )} AND reef_id = ${quoteText(
          reefId,
          "comment reef_id",
        )} AND meta->>'author' = ${quoteText(
          editor,
          "comment editor",
        )} RETURNING *) SELECT * FROM upd`,
      );
      const row = res.kind === "table_query" ? res.items[0] : undefined;
      if (!row) {
        throw new NotFoundError({ resource: `comment ${commentId}` });
      }
      return rowToComment(row);
    },
  );
}
