import { z } from "zod";
import { IsoDateFieldSchema } from "../common/date";
import { StatusEnum } from "../issues/metadata";
import { VaultNameSchema } from "../workspace";
import { MetadataSchema } from "./agentArtifacts";

export const AgentExecutionStatusEnum = z.enum([
  "queued",
  "claimed",
  "running",
  "blocked",
  "failed",
  "cancelled",
  "succeeded",
]);
export type AgentExecutionStatus = z.infer<typeof AgentExecutionStatusEnum>;

export const AgentExecutionPhaseEnum = z.enum([
  "queued",
  "claim",
  "diagnose",
  "plan",
  "implement",
  "converge",
  "handoff",
  "blocked",
  "terminal",
]);
export type AgentExecutionPhase = z.infer<typeof AgentExecutionPhaseEnum>;

export const DevelopmentTargetSchema = z
  .object({
    github_id: z.number().int().positive().nullable().default(null),
    repo: z.string().min(1),
    base_ref: z.string().min(1).nullable().default(null),
    branch: z.string().min(1).nullable().default(null),
    recipe_path: z.string().min(1).nullable().default(null),
    runner_profile: z.string().min(1).nullable().default(null),
    permission_profile: z.string().min(1).nullable().default(null),
    worktree_path: z.string().min(1).nullable().default(null),
    head_sha: z.string().min(1).nullable().default(null),
    pull_request_url: z.string().url().nullable().default(null),
  })
  .strict();
export type DevelopmentTarget = z.infer<typeof DevelopmentTargetSchema>;

export const AgentRunErrorRecordSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    recoverable: z.boolean().default(false),
    details: MetadataSchema.default({}),
  })
  .strict();
export type AgentRunErrorRecord = z.infer<typeof AgentRunErrorRecordSchema>;

export const WorkEventSchema = z
  .object({
    work_event_id: z.string().min(1),
    reef_id: z.string().min(1),
    event_type: z.string().min(1),
    event_key: z.string().min(1),
    occurred_at: IsoDateFieldSchema,
    payload: MetadataSchema.default({}),
    meta: MetadataSchema.default({}),
  })
  .strict();
export type WorkEvent = z.infer<typeof WorkEventSchema>;

export const AgentRunRecordSchema = z
  .object({
    run_id: z.string().min(1),
    reef_id: z.string().min(1),
    work_event_id: z.string().min(1).nullable().default(null),
    task_id: z.string().min(1),
    vault: VaultNameSchema.nullable().default(null),
    status: AgentExecutionStatusEnum,
    phase: AgentExecutionPhaseEnum,
    attempt_number: z.number().int().positive().default(1),
    target: DevelopmentTargetSchema.nullable().default(null),
    input: MetadataSchema.default({}),
    result: MetadataSchema.nullable().default(null),
    error: AgentRunErrorRecordSchema.nullable().default(null),
    queued_at: IsoDateFieldSchema,
    claimed_at: IsoDateFieldSchema.nullable().default(null),
    started_at: IsoDateFieldSchema.nullable().default(null),
    completed_at: IsoDateFieldSchema.nullable().default(null),
    state_updated_at: IsoDateFieldSchema.nullable().default(null),
    meta: MetadataSchema.default({}),
  })
  .strict()
  .superRefine((run, ctx) => {
    if (
      ["failed", "cancelled", "succeeded"].includes(run.status) &&
      run.completed_at == null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "terminal runs must include completed_at",
        path: ["completed_at"],
      });
    }
    if (run.status === "failed" && run.error == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "failed runs must include error",
        path: ["error"],
      });
    }
  });
export type AgentRunRecord = z.infer<typeof AgentRunRecordSchema>;

export const AgentRunWithIssueStatusSchema = z
  .object({
    run: AgentRunRecordSchema,
    issue_status: StatusEnum.nullable(),
  })
  .strict();
export type AgentRunWithIssueStatus = z.infer<
  typeof AgentRunWithIssueStatusSchema
>;

export const AgentRunAttemptSchema = z
  .object({
    attempt_id: z.string().min(1),
    run_id: z.string().min(1),
    attempt_number: z.number().int().positive(),
    status: AgentExecutionStatusEnum,
    phase: AgentExecutionPhaseEnum,
    target: DevelopmentTargetSchema.nullable().default(null),
    started_at: IsoDateFieldSchema,
    completed_at: IsoDateFieldSchema.nullable().default(null),
    result: MetadataSchema.nullable().default(null),
    error: AgentRunErrorRecordSchema.nullable().default(null),
    meta: MetadataSchema.default({}),
  })
  .strict()
  .superRefine((attempt, ctx) => {
    if (
      ["failed", "cancelled", "succeeded"].includes(attempt.status) &&
      attempt.completed_at == null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "terminal attempts must include completed_at",
        path: ["completed_at"],
      });
    }
    if (attempt.status === "failed" && attempt.error == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "failed attempts must include error",
        path: ["error"],
      });
    }
  });
export type AgentRunAttempt = z.infer<typeof AgentRunAttemptSchema>;

export const AgentRunEventRecordSchema = z
  .object({
    run_event_id: z.string().min(1),
    run_id: z.string().min(1),
    attempt_id: z.string().min(1).nullable().default(null),
    seq: z.number().int().nonnegative(),
    event_type: z.string().min(1),
    phase: AgentExecutionPhaseEnum.nullable().default(null),
    emitted_at: IsoDateFieldSchema,
    payload: MetadataSchema.default({}),
    meta: MetadataSchema.default({}),
  })
  .strict();
export type AgentRunEventRecord = z.infer<typeof AgentRunEventRecordSchema>;
