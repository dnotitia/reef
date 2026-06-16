import { z } from "zod";
import { IsoDateFieldSchema } from "../common/date";
import {
  AgentArtifactSchema,
  AgentArtifactTypeEnum,
  AgentErrorSchema,
  AgentStatusChangeProposalArtifactBaseSchema,
  MetadataSchema,
} from "./agentArtifacts";

export * from "./agentArtifacts";

export const AgentRunStatusEnum = z.enum([
  "running",
  "completed",
  "empty",
  "error",
  "cancelled",
]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusEnum>;

export const AgentRunEventTypeEnum = z.enum([
  "run.started",
  "run.completed",
  "run.empty",
  "run.cancelled",
  "run.error",
  "stage.started",
  "stage.completed",
  "stage.error",
  "tool.called",
  "tool.completed",
  "tool.error",
  "model.delta",
  "artifact.partial",
  "artifact.final",
  "repair.started",
  "repair.completed",
  "repair.failed",
]);
const AgentRunEventBaseSchema = z.object({
  event_id: z.string().min(1),
  run_id: z.string().min(1),
  task_id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  created_at: IsoDateFieldSchema,
  metadata: MetadataSchema.default({}),
});

const AgentStagePayloadSchema = z.object({
  stage_id: z.string().min(1),
  name: z.string().min(1),
});

const AgentToolPayloadSchema = z.object({
  tool_call_id: z.string().min(1),
  tool_name: z.string().min(1),
});

const AgentRepairPayloadSchema = z.object({
  attempt: z.number().int().positive(),
  reason: z.string().min(1),
  policy: z.string().min(1).nullable().default(null),
});

const AgentRunStartedEventSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("run.started"),
  run_status: z.literal("running"),
  input: MetadataSchema.default({}),
});

const AgentRunCompletedEventSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("run.completed"),
  run_status: z.literal("completed"),
  artifact_ids: z.array(z.string().min(1)).default([]),
  usage: MetadataSchema.default({}),
});

const AgentRunEmptyEventSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("run.empty"),
  run_status: z.literal("empty"),
  reason: z.string().min(1).nullable().default(null),
});

const AgentRunCancelledEventSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("run.cancelled"),
  run_status: z.literal("cancelled"),
  reason: z.string().min(1).nullable().default(null),
});

const AgentRunErrorEventSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("run.error"),
  run_status: z.literal("error"),
  error: AgentErrorSchema,
});

const AgentStageStartedEventSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("stage.started"),
  stage: AgentStagePayloadSchema,
});

const AgentStageCompletedEventSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("stage.completed"),
  stage: AgentStagePayloadSchema,
  output: MetadataSchema.default({}),
});

const AgentStageErrorEventSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("stage.error"),
  stage: AgentStagePayloadSchema,
  error: AgentErrorSchema,
});

const AgentToolCalledEventSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("tool.called"),
  tool: AgentToolPayloadSchema,
  input: MetadataSchema.default({}),
});

const AgentToolCompletedEventSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("tool.completed"),
  tool: AgentToolPayloadSchema,
  output: MetadataSchema.default({}),
});

const AgentToolErrorEventSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("tool.error"),
  tool: AgentToolPayloadSchema,
  error: AgentErrorSchema,
});

const AgentModelDeltaEventSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("model.delta"),
  delta: z.string(),
  channel: z.enum(["text", "reasoning", "tool"]).default("text"),
});

const AgentArtifactPartialEventSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("artifact.partial"),
  artifact_id: z.string().min(1),
  artifact_type: AgentArtifactTypeEnum,
  delta: MetadataSchema.default({}),
});

const AgentArtifactFinalEventBaseSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("artifact.final"),
  artifact: AgentArtifactSchema,
});

const assertFinalEventArtifactMatches = (
  event: z.infer<typeof AgentArtifactFinalEventBaseSchema>,
  ctx: z.RefinementCtx,
) => {
  if (event.artifact.run_id !== event.run_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "artifact run_id must match event run_id",
      path: ["artifact", "run_id"],
    });
  }
  if (event.artifact.task_id !== event.task_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "artifact task_id must match event task_id",
      path: ["artifact", "task_id"],
    });
  }
};

const AgentRepairStartedEventSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("repair.started"),
  repair: AgentRepairPayloadSchema,
});

const AgentRepairCompletedEventSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("repair.completed"),
  repair: AgentRepairPayloadSchema,
  output: MetadataSchema.default({}),
});

const AgentRepairFailedEventSchema = AgentRunEventBaseSchema.extend({
  type: z.literal("repair.failed"),
  repair: AgentRepairPayloadSchema,
  error: AgentErrorSchema,
});

export const AgentRunEventSchema = z
  .discriminatedUnion("type", [
    AgentRunStartedEventSchema,
    AgentRunCompletedEventSchema,
    AgentRunEmptyEventSchema,
    AgentRunCancelledEventSchema,
    AgentRunErrorEventSchema,
    AgentStageStartedEventSchema,
    AgentStageCompletedEventSchema,
    AgentStageErrorEventSchema,
    AgentToolCalledEventSchema,
    AgentToolCompletedEventSchema,
    AgentToolErrorEventSchema,
    AgentModelDeltaEventSchema,
    AgentArtifactPartialEventSchema,
    AgentArtifactFinalEventBaseSchema,
    AgentRepairStartedEventSchema,
    AgentRepairCompletedEventSchema,
    AgentRepairFailedEventSchema,
  ])
  .superRefine((event, ctx) => {
    if (event.type === "artifact.final") {
      assertFinalEventArtifactMatches(event, ctx);
    }
  });
export type AgentRunEvent = z.infer<typeof AgentRunEventSchema>;

export const AgentRunEnvelopeSchema = z
  .object({
    run_id: z.string().min(1),
    task_id: z.string().min(1),
    status: AgentRunStatusEnum,
    started_at: IsoDateFieldSchema,
    completed_at: IsoDateFieldSchema.nullable().default(null),
    input: MetadataSchema.default({}),
    events: z.array(AgentRunEventSchema).default([]),
    artifacts: z.array(AgentArtifactSchema).default([]),
    error: AgentErrorSchema.nullable().default(null),
    metadata: MetadataSchema.default({}),
  })
  .superRefine((envelope, ctx) => {
    envelope.events.forEach((event, index) => {
      if (event.run_id !== envelope.run_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "event run_id must match envelope run_id",
          path: ["events", index, "run_id"],
        });
      }
      if (event.task_id !== envelope.task_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "event task_id must match envelope task_id",
          path: ["events", index, "task_id"],
        });
      }
      if (event.type === "artifact.final") {
        if (event.artifact.run_id !== envelope.run_id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "artifact run_id must match envelope run_id",
            path: ["events", index, "artifact", "run_id"],
          });
        }
        if (event.artifact.task_id !== envelope.task_id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "artifact task_id must match envelope task_id",
            path: ["events", index, "artifact", "task_id"],
          });
        }
      }
    });

    envelope.artifacts.forEach((artifact, index) => {
      if (artifact.run_id !== envelope.run_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "artifact run_id must match envelope run_id",
          path: ["artifacts", index, "run_id"],
        });
      }
      if (artifact.task_id !== envelope.task_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "artifact task_id must match envelope task_id",
          path: ["artifacts", index, "task_id"],
        });
      }
    });
  });
export type AgentRunEnvelope = z.infer<typeof AgentRunEnvelopeSchema>;
