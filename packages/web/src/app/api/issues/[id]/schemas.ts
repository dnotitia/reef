import { IssueUpdateInputSchema } from "@reef/core";
import { z } from "zod";

/**
 * UpdateIssueRequestSchema — BFF Route Handler contract.
 *
 * Lives in apps/web (not packages/core) because it represents an HTTP-edge
 * shape, not a domain model. The update payload is derived from
 * `IssueMetadataSchema` through `IssueUpdateInputSchema`.
 */
export const UpdateIssueRequestSchema = z.object({
  vault: z.string().min(1),
  update: IssueUpdateInputSchema,
});

export type UpdateIssueRequest = z.infer<typeof UpdateIssueRequestSchema>;
