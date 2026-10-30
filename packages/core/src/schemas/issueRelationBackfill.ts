import { z } from "zod";

export const IssueRelationVerificationTimeoutSchema = z
  .number()
  .int()
  .positive();

export const IssueRelationCheckpointSchema = z.object({
  reef_id: z.string().min(1),
  document_uri: z.string().min(1),
  document_commit: z.string().min(1),
  depends_on: z.array(z.string().min(1)),
  related_to: z.array(z.string().min(1)),
});
export type IssueRelationCheckpoint = z.infer<
  typeof IssueRelationCheckpointSchema
>;

const IssueRelationBackfillProblemSchema = z.object({
  reef_id: z.string().min(1),
  reason: z.enum([
    "invalid_document_identity",
    "missing_document",
    "malformed_array",
    "document_uri_in_row",
    "cross_vault_reference",
    "unresolved_document_uri",
    "missing_target",
    "projection_pending",
    "verification_incomplete",
  ]),
  field: z.enum(["depends_on", "blocks", "related_to"]).optional(),
  target_index: z.number().int().nonnegative().optional(),
  replacement_reef_id: z.string().min(1).optional(),
  missing_count: z.number().int().nonnegative().optional(),
  unexpected_count: z.number().int().nonnegative().optional(),
});
export type IssueRelationBackfillProblem = z.infer<
  typeof IssueRelationBackfillProblemSchema
>;

export const IssueRelationBackfillReportSchema = z.object({
  vault: z.string().min(1),
  phase: z.enum(["preflight", "instructions", "write", "verify"]),
  code: z.enum([
    "invalid_relations",
    "document_missing",
    "projection_pending",
    "source_changed",
    "upstream_error",
    "checkpoint_error",
    "unexpected_error",
  ]),
  problems: z.array(IssueRelationBackfillProblemSchema),
  status: z.number().int().nonnegative().optional(),
});
export type IssueRelationBackfillReport = z.infer<
  typeof IssueRelationBackfillReportSchema
>;
