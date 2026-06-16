import { z } from "zod";
import { SchemaValidationError } from "../../errors";
import {
  AGENT_PIPELINE_STAGE_IDS,
  type AgentPipelineStageId,
  type AgentRuntimeMetadata,
  type AgentStageHandler,
  type AgentTaskDefinition,
  type AgentTaskStage,
} from "./runtime";

export const AgentTaskIdEnum = z.enum([
  "chat.workspace",
  "issue.enrichment",
  "activity.scan",
  "activity.issue-link",
  "activity.draft",
  "activity.status-change",
]);
export type AgentTaskId = z.infer<typeof AgentTaskIdEnum>;

export const AgentExecutionModeEnum = z.enum([
  "tool-loop-stream",
  "tool-loop-json",
  "one-shot-json",
  "deterministic",
  "custom",
]);
export type AgentExecutionMode = z.infer<typeof AgentExecutionModeEnum>;

const AgentRepairPolicyEnum = z.enum([
  "none",
  "json-repair",
  "schema-retry",
  "drop-invalid",
]);
type AgentRepairPolicy = z.infer<typeof AgentRepairPolicyEnum>;

const AgentToolsetPolicyEnum = z.enum([
  "none",
  "workspace-read",
  "repo-read",
  "issue-authoring",
  "activity-scan",
]);
type AgentToolsetPolicy = z.infer<typeof AgentToolsetPolicyEnum>;

const AgentPipelineStageIdEnum = z.enum(AGENT_PIPELINE_STAGE_IDS);

export const AgentTaskRegistryEntrySchema = z
  .object({
    taskId: AgentTaskIdEnum,
    functionId: z.string().min(1),
    spanName: z.string().min(1),
    executionMode: AgentExecutionModeEnum,
    maxSteps: z.number().int().positive().nullable(),
    tokenLimit: z.number().int().positive().nullable(),
    temperature: z.number().min(0).max(2).nullable(),
    outputSchema: z.string().min(1),
    repairPolicy: AgentRepairPolicyEnum,
    toolsetPolicy: z.array(AgentToolsetPolicyEnum).min(1),
    stages: z.array(AgentPipelineStageIdEnum).min(1),
  })
  .strict();
export type AgentTaskRegistryEntry = z.infer<
  typeof AgentTaskRegistryEntrySchema
>;

export const AgentTaskRegistrySchema = z.record(
  AgentTaskIdEnum,
  AgentTaskRegistryEntrySchema,
);
export type AgentTaskRegistry = z.infer<typeof AgentTaskRegistrySchema>;

const SUPPORTED_AGENT_EXECUTION_MODES = [
  "tool-loop-stream",
  "tool-loop-json",
  "one-shot-json",
  "deterministic",
] as const satisfies readonly AgentExecutionMode[];

const STANDARD_STAGES = [...AGENT_PIPELINE_STAGE_IDS];

export const DEFAULT_AGENT_TASK_REGISTRY = AgentTaskRegistrySchema.parse({
  "chat.workspace": {
    taskId: "chat.workspace",
    functionId: "reef.agent.chat.workspace",
    spanName: "reef.agent.chat",
    executionMode: "tool-loop-stream",
    maxSteps: 10,
    tokenLimit: null,
    temperature: 0.2,
    outputSchema: "chat_message",
    repairPolicy: "none",
    toolsetPolicy: ["workspace-read", "repo-read"],
    stages: STANDARD_STAGES,
  },
  "issue.enrichment": {
    taskId: "issue.enrichment",
    functionId: "reef.agent.issue.enrichment",
    spanName: "reef.agent.issue_enrichment",
    executionMode: "one-shot-json",
    maxSteps: 8,
    tokenLimit: 4000,
    temperature: 0.1,
    outputSchema: "field_suggestion",
    repairPolicy: "json-repair",
    toolsetPolicy: ["workspace-read", "repo-read"],
    stages: STANDARD_STAGES,
  },
  "activity.scan": {
    taskId: "activity.scan",
    functionId: "reef.agent.activity.scan",
    spanName: "reef.agent.activity_scan",
    executionMode: "deterministic",
    maxSteps: null,
    tokenLimit: null,
    temperature: null,
    outputSchema: "activity_suggestion_batch",
    repairPolicy: "drop-invalid",
    toolsetPolicy: ["workspace-read", "repo-read", "activity-scan"],
    stages: STANDARD_STAGES,
  },
  "activity.issue-link": {
    taskId: "activity.issue-link",
    functionId: "reef.agent.activity.issue_link",
    spanName: "reef.agent.activity_issue_link",
    executionMode: "one-shot-json",
    maxSteps: 6,
    tokenLimit: 2000,
    temperature: 0,
    outputSchema: "activity_issue_link_decision",
    repairPolicy: "schema-retry",
    toolsetPolicy: ["workspace-read"],
    stages: STANDARD_STAGES,
  },
  "activity.draft": {
    taskId: "activity.draft",
    functionId: "reef.agent.activity.draft",
    spanName: "reef.agent.activity_draft",
    executionMode: "one-shot-json",
    maxSteps: 6,
    tokenLimit: 3000,
    temperature: 0.1,
    outputSchema: "issue_create_proposal",
    repairPolicy: "json-repair",
    toolsetPolicy: ["workspace-read", "repo-read", "issue-authoring"],
    stages: STANDARD_STAGES,
  },
  "activity.status-change": {
    taskId: "activity.status-change",
    functionId: "reef.agent.activity.status_change",
    spanName: "reef.agent.activity_status_change",
    executionMode: "deterministic",
    maxSteps: null,
    tokenLimit: null,
    temperature: null,
    outputSchema: "status_change_proposal",
    repairPolicy: "none",
    toolsetPolicy: ["workspace-read", "activity-scan"],
    stages: STANDARD_STAGES,
  },
});

export type AgentStageHandlerMap<TState> = Record<
  string,
  AgentStageHandler<TState> | undefined
>;

export interface AgentTaskFactoryContext<TState> {
  initial_state: TState | (() => TState);
  stageHandlers: AgentStageHandlerMap<TState>;
  metadata?: AgentRuntimeMetadata;
}

const toSchemaValidationError = (
  field: string,
  received: unknown,
  issues: string[],
) =>
  new SchemaValidationError({
    field,
    received,
    issues,
  });

const parseRegistryEntry = (
  entry: unknown,
  field = "agent task registry entry",
) => {
  const parsed = AgentTaskRegistryEntrySchema.safeParse(entry);
  if (!parsed.success) {
    throw toSchemaValidationError(
      field,
      entry,
      parsed.error.issues.map((issue) => issue.message),
    );
  }
  return parsed.data;
};

export const getAgentRegistryEntry = (
  taskId: string,
  registry: AgentTaskRegistry = DEFAULT_AGENT_TASK_REGISTRY,
): AgentTaskRegistryEntry => {
  const parsedTaskId = AgentTaskIdEnum.safeParse(taskId);
  if (!parsedTaskId.success) {
    throw toSchemaValidationError("taskId", taskId, ["Unknown agent task id"]);
  }
  const entry = registry[parsedTaskId.data];
  if (!entry) {
    throw toSchemaValidationError("taskId", taskId, [
      "Agent task is not registered",
    ]);
  }
  return parseRegistryEntry(entry, `registry.${taskId}`);
};

export const createAgentTask = <TState>(
  entry: AgentTaskRegistryEntry,
  context: AgentTaskFactoryContext<TState>,
): AgentTaskDefinition<TState> => {
  const parsedEntry = parseRegistryEntry(entry);
  if (
    !SUPPORTED_AGENT_EXECUTION_MODES.includes(
      parsedEntry.executionMode as never,
    )
  ) {
    throw toSchemaValidationError("executionMode", parsedEntry.executionMode, [
      "Unsupported agent execution mode",
    ]);
  }

  const stages = parsedEntry.stages.map<AgentTaskStage<TState>>((stageId) => {
    const handler = context.stageHandlers[stageId];
    if (!handler) {
      throw toSchemaValidationError("stageHandlers", stageId, [
        "Missing stage handler",
      ]);
    }
    return {
      stage_id: stageId,
      name: stageId,
      run: handler,
    };
  });

  return {
    task_id: parsedEntry.taskId,
    initial_state: context.initial_state,
    metadata: {
      functionId: parsedEntry.functionId,
      spanName: parsedEntry.spanName,
      executionMode: parsedEntry.executionMode,
      maxSteps: parsedEntry.maxSteps,
      tokenLimit: parsedEntry.tokenLimit,
      temperature: parsedEntry.temperature,
      outputSchema: parsedEntry.outputSchema,
      repairPolicy: parsedEntry.repairPolicy,
      toolsetPolicy: parsedEntry.toolsetPolicy,
      ...(context.metadata ?? {}),
    },
    stages,
  };
};

export const createAgentTaskFromRegistry = <TState>(
  taskId: AgentTaskId | string,
  context: AgentTaskFactoryContext<TState>,
  registry: AgentTaskRegistry = DEFAULT_AGENT_TASK_REGISTRY,
): AgentTaskDefinition<TState> =>
  createAgentTask(getAgentRegistryEntry(taskId, registry), context);
