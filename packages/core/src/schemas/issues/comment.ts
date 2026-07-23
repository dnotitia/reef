import { z } from "zod";
import { IsoDateFieldSchema } from "../common/date";

/**
 * CommentMetaSchema — the `reef_comments.meta` json contract (REEF-062 /
 * REEF-125).
 *
 * akb auto-injects `id`/`created_by`/`created_at`/`updated_at` on the row, but
 * those identify the akb auth principal and akb bookkeeping rather than reef's
 * canonical comment author or "edited" signal (REEF-125 decision). The
 * reef-semantic actor and the edit time live here in `meta` so the create-time
 * table schema stays an extension envelope pending an explicit operator
 * migration, including environments where migration execution is unavailable.
 *
 *   author     — reef semantic actor (akb username) who wrote the comment.
 *   created_at — ISO-8601 write time; the thread's displayed + sort time.
 *   edited_at  — ISO-8601 of the last body edit, or null when not edited.
 */
export const CommentMetaSchema = z
  .object({
    author: z.string().min(1, "comment author is required"),
    created_at: IsoDateFieldSchema,
    edited_at: IsoDateFieldSchema.nullable().default(null),
    parent_comment_id: z.string().uuid().nullable().default(null),
    thread_root_id: z.string().uuid().nullable().default(null),
  })
  .superRefine((meta, ctx) => {
    if ((meta.parent_comment_id === null) !== (meta.thread_root_id === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parent_comment_id"],
        message:
          "comment parent and thread root must both be set or both be null",
      });
    }
  });

/**
 * CommentSchema — a flat issue comment as it crosses the core boundary into
 * web. Wire fields are snake_case (the akb row shape); web imports this type
 * rather than redefining it (REEF-062 AC3). `id` is the akb-assigned uuid;
 * `author`/`created_at`/`edited_at` are projected from `meta`, not from akb's
 * auto columns (see CommentMetaSchema).
 */
export const CommentSchema = z.object({
  id: z.string().min(1, "comment id is required"),
  reef_id: z.string().min(1, "reef_id is required"),
  body: z.string().min(1, "comment body is required"),
  author: z.string().min(1, "comment author is required"),
  created_at: IsoDateFieldSchema,
  edited_at: IsoDateFieldSchema.nullable().default(null),
  parent_comment_id: z.string().uuid().nullable().optional(),
  thread_root_id: z.string().uuid().nullable().optional(),
});
export type Comment = z.infer<typeof CommentSchema>;

/** Upper bound on a stored comment body — keeps a single SQL statement and the
 * request payload bounded. */
const COMMENT_BODY_MAX = 10_000;

const CommentBodySchema = z
  .string()
  .trim()
  .min(1, "comment body is required")
  .max(COMMENT_BODY_MAX, "comment is too long");

/**
 * Create payload (web → core): the body. The author is the session actor
 * and the reef id is the route path segment — neither is ever taken from the
 * client request body.
 */
export const CommentCreateInputSchema = z.object({
  body: CommentBodySchema,
  parent_comment_id: z.string().uuid().optional(),
});

/** Edit payload (web → core): the replacement body. */
export const CommentUpdateInputSchema = z.object({
  body: CommentBodySchema,
});
