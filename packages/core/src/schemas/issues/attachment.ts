import { z } from "zod";
import { IsoDateFieldSchema } from "../common/date";

export const IssueAttachmentSourceEnum = z.enum([
  "issue_body",
  "comment",
  "jira_import",
]);

export const IssueAttachmentSchema = z.object({
  id: z.string().min(1, "attachment id is required"),
  reef_id: z.string().min(1, "reef_id is required"),
  file_uri: z.string().min(1, "file uri is required"),
  filename: z.string().min(1, "filename is required"),
  mime_type: z.string().min(1, "mime type is required"),
  size_bytes: z.number().int().nonnegative(),
  author: z.string().min(1, "attachment author is required"),
  created_at: IsoDateFieldSchema,
  source: IssueAttachmentSourceEnum,
  inline: z.boolean().default(false),
  original_jira_attachment_id: z.string().nullable().optional(),
  meta: z.record(z.unknown()).nullable().optional(),
});

export const IssueAttachmentCreateInputSchema = IssueAttachmentSchema.omit({
  id: true,
}).strict();

export type IssueAttachment = z.infer<typeof IssueAttachmentSchema>;
export type IssueAttachmentCreateInput = z.infer<
  typeof IssueAttachmentCreateInputSchema
>;
export type IssueAttachmentSource = z.infer<typeof IssueAttachmentSourceEnum>;
