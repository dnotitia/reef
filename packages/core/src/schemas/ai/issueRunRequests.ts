import { z } from "zod";
import { VaultNameSchema } from "../workspace";
import {
  AgentExecutionPhaseEnum,
  AgentExecutionStatusEnum,
} from "./runRecords";

export const IssueRunWorkspaceRoleEnum = z.enum([
  "reader",
  "writer",
  "admin",
  "owner",
]);
export type IssueRunWorkspaceRole = z.infer<typeof IssueRunWorkspaceRoleEnum>;

export const IssueRunRequestEligibilityReasonEnum = z.enum([
  "not_authorized",
  "not_assignee",
  "issue_archived",
  "issue_document_unavailable",
  "issue_type_not_runnable",
  "issue_status_not_todo",
  "unresolved_dependencies",
  "target_missing",
  "target_disabled",
  "target_invalid",
  "profile_unavailable",
  "run_already_active",
]);
export type IssueRunRequestEligibilityReason = z.infer<
  typeof IssueRunRequestEligibilityReasonEnum
>;

export const IssueRunProfileSummarySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
  })
  .strict();

export const IssueRunTargetOptionSchema = z
  .object({
    github_id: z.number().int().positive(),
    repo: z.string().min(1),
    recipe_path: z.string().min(1),
    branch_template: z.string().min(1),
    runner_profile: IssueRunProfileSummarySchema,
    permission_profile: IssueRunProfileSummarySchema,
  })
  .strict();
export type IssueRunTargetOption = z.infer<typeof IssueRunTargetOptionSchema>;

export const IssueRunActiveRunSummarySchema = z
  .object({
    run_id: z.string().min(1),
    status: AgentExecutionStatusEnum,
    phase: AgentExecutionPhaseEnum,
  })
  .strict();
export type IssueRunActiveRunSummary = z.infer<
  typeof IssueRunActiveRunSummarySchema
>;

export const IssueRunRequestEligibilitySchema = z
  .object({
    eligible: z.boolean(),
    reasons: z.array(IssueRunRequestEligibilityReasonEnum),
    target_options: z.array(IssueRunTargetOptionSchema),
    default_target_github_id: z.number().int().positive().nullable(),
    active_run: IssueRunActiveRunSummarySchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.eligible !== (value.reasons.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["eligible"],
        message: "eligible must match the absence of reasons",
      });
    }
    const expectedDefault =
      value.target_options.length === 1
        ? value.target_options[0]?.github_id
        : null;
    if (value.default_target_github_id !== expectedDefault) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["default_target_github_id"],
        message: "a default target is available only for a single option",
      });
    }
  });
export type IssueRunRequestEligibility = z.infer<
  typeof IssueRunRequestEligibilitySchema
>;

export const IssueRunRequestBodySchema = z
  .object({
    vault: VaultNameSchema,
    github_id: z.number().int().positive(),
    request_id: z.string().uuid(),
  })
  .strict();
export type IssueRunRequestBody = z.infer<typeof IssueRunRequestBodySchema>;

export const IssueRunRequestResultSchema = z
  .object({
    run_id: z.string().min(1),
    status: z.literal("queued"),
    created: z.boolean(),
  })
  .strict();
export type IssueRunRequestResult = z.infer<typeof IssueRunRequestResultSchema>;
