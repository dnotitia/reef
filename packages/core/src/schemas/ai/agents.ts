import { z } from "zod";
import { IsoDateFieldSchema } from "../common/date";
import {
  AgentArtifactSchema,
  AgentErrorSchema,
  MetadataSchema,
} from "./agentArtifacts";

export * from "./agentArtifacts";

const AgentRunStatusEnum = z.enum([
  "running",
  "completed",
  "empty",
  "error",
  "cancelled",
]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusEnum>;

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
      code: "custom",
      message: "artifact run_id must match event run_id",
      path: ["artifact", "run_id"],
    });
  }
  if (event.artifact.task_id !== event.task_id) {
    ctx.addIssue({
      code: "custom",
      message: "artifact task_id must match event task_id",
      path: ["artifact", "task_id"],
    });
  }
};

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
    AgentArtifactFinalEventBaseSchema,
  ])
  .superRefine((event, ctx) => {
    if (event.type === "artifact.final") {
      assertFinalEventArtifactMatches(event, ctx);
    }
  });
export type AgentRunEvent = z.infer<typeof AgentRunEventSchema>;
