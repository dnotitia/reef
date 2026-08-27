import { ZodError } from "zod";
import {
  ConflictError,
  NotFoundError,
  SchemaValidationError,
} from "../../../errors";
import { filterValidCommentThreadMembers } from "../../../models/commentThreads";
import {
  type Comment,
  type CommentDeletionResult,
  CommentDeletionResultSchema,
  CommentMetaSchema,
  CommentSchema,
} from "../../../schemas/issues/comment";
import {
  buildMentionRecipients,
  extractMentionUsernames,
  parsePersistedMentionRecipients,
} from "../../../schemas/issues/mention";
import {
  type AkbAdapter,
  REEF_COMMENTS_TABLE,
  REEF_ISSUES_TABLE,
  REEF_NOTIFICATIONS_TABLE,
  decodeSettingsValue,
  ensureReefTables,
  isMissingTableError,
  quoteIdent,
  SqlParameterBuilder,
  runSql,
  tableRef,
  withSpan,
} from "../core/shared";
import { upsertSubscription } from "../notifications/notifications";
import { listVaultMembers } from "../workspace/vaults";

async function resolveMentionRecipients(
  adapter: AkbAdapter,
  vault: string,
  body: string,
): Promise<string[]> {
  const usernames = extractMentionUsernames(body);
  if (usernames.length === 0) return [];

  const { members } = await listVaultMembers({ adapter, vault });
  const recipients = buildMentionRecipients(
    body,
    members.map((member) => member.username),
  );
  if (recipients.length !== new Set(usernames).size) {
    // Omit the unresolved username so a rejected save does not expose roster
    // membership or authorization details.
    throw new SchemaValidationError({ field: "comment mentions" });
  }
  return recipients;
}

/**
 * Map a `reef_comments` row to a Comment. The reef-semantic author and the
 * created/edited timestamps are projected from the row's `meta` json — NOT from
 * akb's auto `created_by`/`created_at` columns (REEF-125): those are the akb
 * auth principal and akb bookkeeping, not reef's canonical source.
 */
function rowToComment(row: Record<string, unknown>): Comment {
  try {
    const decodedMeta = decodeSettingsValue(row.meta) ?? {};
    const meta = CommentMetaSchema.parse(decodedMeta);
    const mentionRecipients =
      typeof decodedMeta === "object" && decodedMeta !== null
        ? parsePersistedMentionRecipients(
            (decodedMeta as Record<string, unknown>).mention_recipients,
          )
        : [];
    return CommentSchema.parse({
      id: row.id,
      reef_id: row.reef_id,
      body: row.body,
      author: meta.author,
      created_at: meta.created_at,
      edited_at: meta.edited_at,
      parent_comment_id: meta.parent_comment_id,
      thread_root_id: meta.thread_root_id,
      mention_recipients: mentionRecipients,
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
 * as an empty thread WITHOUT reconciling — a read does not provision (REEF-125
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
        const sqlParams = new SqlParameterBuilder();
        const res = await runSql(
          adapter,
          vault,
          `SELECT * FROM ${tableRef(REEF_COMMENTS_TABLE)} WHERE reef_id = ${sqlParams.add(
            reefId,
            "comment reef_id",
          )} ORDER BY meta->>'created_at' ASC, id ASC`,
          sqlParams.params,
        );
        rows = res.kind === "table_query" ? res.items : [];
      } catch (err) {
        if (isMissingTableError(err)) {
          span.setAttribute("table_exists", false);
          return [];
        }
        throw err;
      }
      const parsedComments: Comment[] = [];
      for (const row of rows) {
        try {
          parsedComments.push(rowToComment(row));
        } catch {
          // Skip a malformed comment row rather than failing the whole thread.
        }
      }
      const comments = filterValidCommentThreadMembers(parsedComments);
      span.setAttribute("comment_count", comments.length);
      span.setAttribute(
        "malformed_comment_count",
        rows.length - comments.length,
      );
      return comments;
    },
  );
}

/**
 * Create a comment on an issue and return it in a single statement. The INSERT
 * is wrapped in a data-modifying CTE so the akb-assigned uuid `id` and the
 * row's persisted state come back via RETURNING with no separate read-back
 * (mirrors `insertAndReadPlanningRow`). `author` is the session actor resolved
 * by the route — not client-supplied — and is stored in `meta` (REEF-125).
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
  parentCommentId?: string,
  preserved?: {
    createdAt: string;
    editedAt: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<Comment> {
  return withSpan(
    "akb.create_comment",
    { vault, reef_id: reefId },
    async () => {
      const mentionRecipients = await resolveMentionRecipients(
        adapter,
        vault,
        body,
      );
      await ensureReefTables({ adapter, vault });
      const createdAt = preserved?.createdAt ?? new Date().toISOString();
      const editedAt = preserved?.editedAt ?? null;
      const metadata = Object.fromEntries(
        Object.entries(preserved?.metadata ?? {}).filter(
          ([key]) =>
            ![
              "author",
              "created_at",
              "edited_at",
              "parent_comment_id",
              "thread_root_id",
              "mention_recipients",
            ].includes(key),
        ),
      );
      metadata.mention_recipients = mentionRecipients;
      const meta = {
        ...metadata,
        author,
        created_at: createdAt,
        edited_at: editedAt,
        parent_comment_id: null,
        thread_root_id: null,
      };
      const sqlParams = new SqlParameterBuilder();
      const idempotencyKey =
        typeof metadata.jira_idempotency_key === "string"
          ? metadata.jira_idempotency_key
          : null;
      let claimCtes = "";
      if (idempotencyKey) {
        const idempotencyParam = sqlParams.add(
          idempotencyKey,
          "comment idempotency key",
        );
        claimCtes = `claim_lock AS (SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyParam}, 0))), existing AS (SELECT comment.* FROM ${tableRef(
          REEF_COMMENTS_TABLE,
        )} comment CROSS JOIN claim_lock WHERE comment.meta->>'jira_idempotency_key' = ${idempotencyParam} LIMIT 1), `;
      }
      const reefIdParam = sqlParams.add(reefId, "comment reef_id");
      const issueGuard = `SELECT reef_id FROM ${tableRef(
        REEF_ISSUES_TABLE,
      )} WHERE reef_id = ${reefIdParam} LIMIT 1`;
      const resultSelection = idempotencyKey
        ? "SELECT * FROM ins UNION ALL SELECT * FROM existing LIMIT 1"
        : "SELECT * FROM ins";
      const claimJoin = idempotencyKey
        ? " CROSS JOIN claim_lock WHERE NOT EXISTS (SELECT 1 FROM existing)"
        : "";
      const sql = parentCommentId
        ? (() => {
            const parentParam = sqlParams.add(
              parentCommentId,
              "parent comment id",
            );
            const bodyParam = sqlParams.add(body, "comment body");
            const authorParam = sqlParams.add(author, "comment author");
            const createdAtParam = sqlParams.add(
              createdAt,
              "comment created_at",
            );
            const editedAtParam =
              editedAt === null
                ? "NULL"
                : `${sqlParams.add(editedAt, "comment edited_at")}::text`;
            const metadataParam = sqlParams.addJson(
              metadata,
              "comment metadata",
              "jsonb",
            );
            return `WITH RECURSIVE ${claimCtes}target_issue AS (${issueGuard}), direct_parent AS (SELECT * FROM ${tableRef(
              REEF_COMMENTS_TABLE,
            )} WHERE id = ${parentParam} AND reef_id = ${reefIdParam}), reply_target AS (SELECT direct_parent.id::text AS parent_id, CASE WHEN direct_parent.meta->>'parent_comment_id' IS NULL AND direct_parent.meta->>'thread_root_id' IS NULL THEN direct_parent.id::text ELSE direct_parent.meta->>'thread_root_id' END AS root_id FROM direct_parent), parent_chain AS (SELECT direct_parent.id::text AS id, direct_parent.reef_id, direct_parent.meta, 0 AS depth FROM direct_parent UNION ALL SELECT chain_parent.id::text, chain_parent.reef_id, chain_parent.meta, parent_chain.depth + 1 FROM parent_chain JOIN ${tableRef(
              REEF_COMMENTS_TABLE,
            )} chain_parent ON chain_parent.id::text = parent_chain.meta->>'parent_comment_id' AND chain_parent.reef_id = ${reefIdParam} WHERE parent_chain.depth < 100), valid_reply AS (SELECT reply_target.parent_id, reply_target.root_id FROM reply_target JOIN ${tableRef(
              REEF_COMMENTS_TABLE,
            )} root_comment ON root_comment.id::text = reply_target.root_id AND root_comment.reef_id = ${reefIdParam} WHERE root_comment.meta->>'parent_comment_id' IS NULL AND root_comment.meta->>'thread_root_id' IS NULL AND EXISTS (SELECT 1 FROM parent_chain WHERE parent_chain.id = reply_target.root_id AND parent_chain.meta->>'parent_comment_id' IS NULL AND parent_chain.meta->>'thread_root_id' IS NULL) AND NOT EXISTS (SELECT 1 FROM parent_chain WHERE parent_chain.id <> reply_target.root_id AND (parent_chain.meta->>'parent_comment_id' IS NULL OR parent_chain.meta->>'thread_root_id' IS DISTINCT FROM reply_target.root_id))), ins AS (INSERT INTO ${tableRef(
              REEF_COMMENTS_TABLE,
            )} (${quoteIdent("reef_id")}, ${quoteIdent("body")}, ${quoteIdent(
              "meta",
            )}) SELECT target_issue.reef_id, ${bodyParam}, jsonb_build_object('author', ${authorParam}::text, 'created_at', ${createdAtParam}::text, 'edited_at', ${editedAtParam}, 'parent_comment_id', valid_reply.parent_id, 'thread_root_id', valid_reply.root_id) || ${metadataParam} FROM target_issue CROSS JOIN valid_reply${claimJoin} RETURNING *) ${resultSelection}`;
          })()
        : (() => {
            const bodyParam = sqlParams.add(body, "comment body");
            const metaParam = sqlParams.addJson(meta, "comment meta");
            return `WITH ${claimCtes}target_issue AS (${issueGuard}), ins AS (INSERT INTO ${tableRef(
              REEF_COMMENTS_TABLE,
            )} (${quoteIdent("reef_id")}, ${quoteIdent("body")}, ${quoteIdent(
              "meta",
            )}) SELECT ${reefIdParam}, ${bodyParam}, ${metaParam} FROM target_issue${claimJoin} RETURNING *) ${resultSelection}`;
          })();
      const res = await runSql(adapter, vault, sql, sqlParams.params);
      const row = res.kind === "table_query" ? res.items[0] : undefined;
      if (!row) {
        throw parentCommentId
          ? new NotFoundError({ resourceKind: "commentParent" })
          : new NotFoundError({ resource: `issue ${reefId}` });
      }
      const comment = rowToComment(row);
      const compatible =
        comment.reef_id === reefId &&
        comment.body === body &&
        comment.author === author &&
        comment.created_at === createdAt &&
        comment.edited_at === editedAt &&
        (comment.parent_comment_id ?? null) === (parentCommentId ?? null) &&
        (parentCommentId
          ? comment.thread_root_id != null
          : comment.thread_root_id == null);
      if (!compatible) {
        throw new ConflictError({ path: `comment:${comment.id}` });
      }
      await upsertSubscription(adapter, vault, {
        reefId,
        subscriber: comment.author,
        source: "commenter",
        status: "active",
      });
      return comment;
    },
  );
}

/**
 * Edit a comment's body. Ownership is enforced in the WHERE clause: the row is
 * updated when `meta.author` equals the acting `editor`, so a non-author
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
  preserved?: {
    createdAt: string;
    editedAt: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<Comment> {
  return withSpan(
    "akb.update_comment",
    { vault, reef_id: reefId, comment_id: commentId },
    async () => {
      const mentionRecipients = await resolveMentionRecipients(
        adapter,
        vault,
        body,
      );
      await ensureReefTables({ adapter, vault });
      const editedAt = preserved?.editedAt ?? new Date().toISOString();
      const preservedMetadata = preserved
        ? {
            ...Object.fromEntries(
              Object.entries(preserved.metadata ?? {}).filter(
                ([key]) =>
                  ![
                    "author",
                    "created_at",
                    "edited_at",
                    "parent_comment_id",
                    "thread_root_id",
                    "mention_recipients",
                  ].includes(key),
              ),
            ),
            author: editor,
            created_at: preserved.createdAt,
            edited_at: preserved.editedAt,
            mention_recipients: mentionRecipients,
          }
        : null;
      const sqlParams = new SqlParameterBuilder();
      const bodyParam = sqlParams.add(body, "comment body");
      const metaUpdate = preservedMetadata
        ? `meta::jsonb || ${sqlParams.addJson(
            preservedMetadata,
            "comment metadata",
            "jsonb",
          )}`
        : `(jsonb_set(meta::jsonb, '{edited_at}', to_jsonb(${sqlParams.add(
            editedAt,
            "comment edited_at",
          )}::text)) || ${sqlParams.addJson(
            { mention_recipients: mentionRecipients },
            "comment mention metadata",
            "jsonb",
          )})`;
      const metaAssignment = preservedMetadata
        ? `(${metaUpdate})::json`
        : `${metaUpdate}::json`;
      const commentIdParam = sqlParams.add(commentId, "comment id");
      const reefIdParam = sqlParams.add(reefId, "comment reef_id");
      const editorParam = sqlParams.add(editor, "comment editor");
      const res = await runSql(
        adapter,
        vault,
        `WITH upd AS (UPDATE ${tableRef(
          REEF_COMMENTS_TABLE,
        )} SET body = ${bodyParam}, meta = ${metaAssignment} WHERE id = ${commentIdParam} AND reef_id = ${reefIdParam} AND meta->>'author' = ${editorParam} RETURNING *) SELECT * FROM upd`,
        sqlParams.params,
      );
      const row = res.kind === "table_query" ? res.items[0] : undefined;
      if (!row) {
        throw new NotFoundError({ resource: `comment ${commentId}` });
      }
      return rowToComment(row);
    },
  );
}

/**
 * Permanently delete an authored comment and every reply below it. The target
 * author check, recursive descendant walk, notification cleanup, and comment
 * delete intentionally live in one data-modifying SQL statement so a failed
 * authorization or partial cascade does not leave an orphaned reply or
 * notification (REEF-520).
 */
export async function deleteComment(
  adapter: AkbAdapter,
  vault: string,
  reefId: string,
  commentId: string,
  actor: string,
): Promise<CommentDeletionResult> {
  return withSpan(
    "akb.delete_comment",
    { vault, reef_id: reefId, comment_id: commentId },
    async (span) => {
      await ensureReefTables({ adapter, vault });
      const sqlParams = new SqlParameterBuilder();
      const targetIdParam = sqlParams.add(commentId, "comment id");
      const targetReefParam = sqlParams.add(reefId, "comment reef_id");
      const actorParam = sqlParams.add(actor, "comment actor");
      const result = await runSql(
        adapter,
        vault,
        `WITH RECURSIVE target AS (SELECT id FROM ${tableRef(
          REEF_COMMENTS_TABLE,
        )} WHERE id = ${targetIdParam} AND reef_id = ${targetReefParam} AND meta->>'author' = ${actorParam}), descendants AS (SELECT id FROM target UNION SELECT child.id FROM ${tableRef(
          REEF_COMMENTS_TABLE,
        )} child JOIN descendants parent ON child.meta->>'parent_comment_id' = parent.id::text WHERE child.reef_id = ${targetReefParam}), deleted_notifications AS (DELETE FROM ${tableRef(
          REEF_NOTIFICATIONS_TABLE,
        )} WHERE reef_id = ${targetReefParam} AND source_type = 'comment' AND source_ref IN (SELECT id::text FROM descendants) RETURNING source_ref), deleted_comments AS (DELETE FROM ${tableRef(
          REEF_COMMENTS_TABLE,
        )} WHERE reef_id = ${targetReefParam} AND id IN (SELECT id FROM descendants) RETURNING id::text AS id) SELECT id FROM deleted_comments ORDER BY id`,
        sqlParams.params,
      );
      const deletedIds =
        result.kind === "table_query"
          ? result.items
              .map((row) => row.id)
              .filter((id): id is string => typeof id === "string")
          : [];
      if (deletedIds.length === 0) {
        throw new NotFoundError({ resource: `comment ${commentId}` });
      }
      const deletion = CommentDeletionResultSchema.parse({
        deleted_comment_ids: deletedIds,
      });
      span.setAttribute(
        "deleted_comment_count",
        deletion.deleted_comment_ids.length,
      );
      return deletion;
    },
  );
}

const JIRA_COMMENT_IDEMPOTENCY_KEY = /^comment:[^:]+:[^:]+:[^:]+$/u;

/**
 * Reconcile a comment row owned by a Jira migration.
 *
 * Ordinary Reef comment edits remain author-scoped through `updateComment`.
 * This narrowly-scoped repair path requires the deterministic Jira comment
 * idempotency key already stored on the exact row, so an operator rerun can
 * replace a fallback author after the corresponding AKB member is invited.
 * Thread identity and akb bookkeeping columns are preserved.
 */
export async function reconcileJiraImportedComment(
  adapter: AkbAdapter,
  vault: string,
  input: {
    commentId: string;
    reefId: string;
    idempotencyKey: string;
    body: string;
    author: string;
    createdAt: string;
    editedAt: string | null;
  },
): Promise<Comment> {
  if (!JIRA_COMMENT_IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
    throw new SchemaValidationError({
      issues: ["Jira comment reconciliation requires a Jira comment key"],
    });
  }
  return withSpan(
    "akb.reconcile_jira_imported_comment",
    {
      vault,
      reef_id: input.reefId,
      comment_id: input.commentId,
    },
    async () => {
      const mentionRecipients = await resolveMentionRecipients(
        adapter,
        vault,
        input.body,
      );
      await ensureReefTables({ adapter, vault });
      const migrationMeta = {
        author: input.author,
        created_at: input.createdAt,
        edited_at: input.editedAt,
        jira_idempotency_key: input.idempotencyKey,
        mention_recipients: mentionRecipients,
      };
      const sqlParams = new SqlParameterBuilder();
      const bodyParam = sqlParams.add(input.body, "comment body");
      const metadataParam = sqlParams.addJson(
        migrationMeta,
        "comment migration metadata",
        "jsonb",
      );
      const commentIdParam = sqlParams.add(input.commentId, "comment id");
      const reefIdParam = sqlParams.add(input.reefId, "comment reef_id");
      const idempotencyParam = sqlParams.add(
        input.idempotencyKey,
        "comment idempotency key",
      );
      const res = await runSql(
        adapter,
        vault,
        `WITH upd AS (UPDATE ${tableRef(
          REEF_COMMENTS_TABLE,
        )} SET body = ${bodyParam}, meta = (meta::jsonb || ${metadataParam})::json WHERE id = ${commentIdParam} AND reef_id = ${reefIdParam} AND meta->>'jira_idempotency_key' = ${idempotencyParam} RETURNING *) SELECT * FROM upd`,
        sqlParams.params,
      );
      const row = res.kind === "table_query" ? res.items[0] : undefined;
      if (!row) {
        throw new NotFoundError({
          resource: `Jira comment ${input.commentId}`,
        });
      }
      return rowToComment(row);
    },
  );
}
