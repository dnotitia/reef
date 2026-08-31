import { z } from "zod";
import { IsoDateFieldSchema } from "../common/date";
import { IssueMetadataSchema } from "./metadata";

const changeBase = {
  id: z.string().min(1, "change id is required"),
  at: IsoDateFieldSchema,
  actor: z.string().nullable(),
} as const;

const attachmentChangeFields = {
  attachment_id: z.string().min(1),
  filename: z.string().min(1),
  file_uri: z.string().min(1),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
} as const;

/** One normalized change shown inside an Issue Change Group. */
export const IssueChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    ...changeBase,
    kind: z.literal("created"),
    title: z.string().min(1),
  }),
  z.object({
    ...changeBase,
    kind: z.literal("field_change"),
    /** Activity discriminator, e.g. `priority_change` or `labels_change`. */
    event_type: z.string().min(1),
    /** The field name used by the display, when one is available. */
    field: z.string().min(1),
    /** Scalar or set values from the activity payload. */
    from: z.unknown(),
    to: z.unknown(),
    payload: z.record(z.string(), z.unknown()),
  }),
  z.object({
    ...changeBase,
    kind: z.literal("body_update"),
    hash: z.string().min(1),
    /** Unified diff text. Null means the source exposed the update but no diff. */
    diff: z.string().nullable(),
  }),
  z.object({
    ...changeBase,
    kind: z.literal("comment_added"),
    comment_id: z.string().min(1),
    body: z.string().min(1),
  }),
  z.object({
    ...changeBase,
    kind: z.literal("attachment_added"),
    ...attachmentChangeFields,
  }),
  z.object({
    ...changeBase,
    kind: z.literal("attachment_removed"),
    ...attachmentChangeFields,
  }),
]);
export type IssueChange = z.infer<typeof IssueChangeSchema>;

/** One ticket and all changes observed for it in the selected period. */
export const IssueChangeReviewGroupSchema = z.object({
  issue: IssueMetadataSchema,
  changes: z.array(IssueChangeSchema).min(1),
});
export type IssueChangeReviewGroup = z.infer<
  typeof IssueChangeReviewGroupSchema
>;

/** Normalized half-open period: start inclusive, end exclusive. */
export const IssueChangeReviewRangeSchema = z
  .object({
    start_at: IsoDateFieldSchema,
    end_at: IsoDateFieldSchema,
  })
  .superRefine((range, ctx) => {
    if (Date.parse(range.start_at) >= Date.parse(range.end_at)) {
      ctx.addIssue({
        code: "custom",
        path: ["end_at"],
        message: "change review end must be after start",
      });
    }
  });
export type IssueChangeReviewRange = z.infer<
  typeof IssueChangeReviewRangeSchema
>;

/** Core response returned by the period review adapter and Route Handler. */
export const IssueChangeReviewResponseSchema = z.object({
  start_at: IsoDateFieldSchema,
  end_at: IsoDateFieldSchema,
  groups: z.array(IssueChangeReviewGroupSchema),
});
export type IssueChangeReviewResponse = z.infer<
  typeof IssueChangeReviewResponseSchema
>;
