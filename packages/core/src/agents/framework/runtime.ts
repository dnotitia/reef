import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  type AgentArtifact,
  AgentArtifactSchema,
  type AgentError,
  type AgentRunEnvelope,
  AgentRunEnvelopeSchema,
  type AgentRunEvent,
  AgentRunEventSchema,
  type AgentRunStatus,
  AgentRunStatusEnum,
} from "./events";

const tracer = trace.getTracer("@reef/core");

export const AGENT_PIPELINE_STAGE_IDS = [
  "prepareContext",
  "buildPrompt",
  "buildTools",
  "execute",
  "decode",
  "repair",
  "normalize",
  "present/persist",
] as const;
export type AgentPipelineStageId = (typeof AGENT_PIPELINE_STAGE_IDS)[number];

export type AgentRuntimeMetadata = Record<string, unknown>;
export type AgentRuntimeUsage = Record<string, unknown>;
type AgentRunEventInput = { type: string; [key: string]: unknown };
export type AgentTerminalRunStatus = Extract<
  AgentRunStatus,
  "completed" | "empty"
>;

export type AgentRuntimeEmission =
  | {
      type: "tool.called";
      tool: { tool_call_id: string; tool_name: string };
      input?: AgentRuntimeMetadata;
      metadata?: AgentRuntimeMetadata;
    }
  | {
      type: "tool.completed";
      tool: { tool_call_id: string; tool_name: string };
      output?: AgentRuntimeMetadata;
      metadata?: AgentRuntimeMetadata;
    }
  | {
      type: "tool.error";
      tool: { tool_call_id: string; tool_name: string };
      error: AgentError;
      metadata?: AgentRuntimeMetadata;
    }
  | {
      type: "model.delta";
      delta: string;
      channel?: "text" | "reasoning" | "tool";
      metadata?: AgentRuntimeMetadata;
    }
  | {
      type: "artifact.partial";
      artifact_id: string;
      artifact_type: AgentArtifact["type"];
      delta?: AgentRuntimeMetadata;
      metadata?: AgentRuntimeMetadata;
    }
  | {
      type: "artifact.final";
      artifact: AgentArtifact;
      metadata?: AgentRuntimeMetadata;
    }
  | {
      type: "repair.started";
      repair: { attempt: number; reason: string; policy?: string | null };
      metadata?: AgentRuntimeMetadata;
    }
  | {
      type: "repair.completed";
      repair: { attempt: number; reason: string; policy?: string | null };
      output?: AgentRuntimeMetadata;
      metadata?: AgentRuntimeMetadata;
    }
  | {
      type: "repair.failed";
      repair: { attempt: number; reason: string; policy?: string | null };
      error: AgentError;
      metadata?: AgentRuntimeMetadata;
    };

export type AgentStageEmission<TState> =
  | { type: "event"; event: AgentRuntimeEmission }
  | { type: "result"; result: AgentStageResult<TState> };

export interface AgentStageResult<TState> {
  state?: TState;
  output?: AgentRuntimeMetadata;
  artifacts?: AgentArtifact[];
  usage?: AgentRuntimeUsage;
  finish_reason?: string | null;
  final_status?: AgentTerminalRunStatus;
}

export interface AgentStageExecutionContext<TState> {
  run_id: string;
  task_id: string;
  stage_id: string;
  signal?: AbortSignal;
  state: TState;
  emit: (event: AgentRuntimeEmission) => void;
}

export type AgentStageHandler<TState> = (
  context: AgentStageExecutionContext<TState>,
) =>
  | AgentStageResult<TState>
  | Promise<AgentStageResult<TState>>
  | AsyncIterable<AgentStageEmission<TState>>;

export interface AgentTaskStage<TState> {
  stage_id: AgentPipelineStageId | string;
  name?: string;
  run: AgentStageHandler<TState>;
}

export interface AgentTaskDefinition<TState> {
  task_id: string;
  stages: AgentTaskStage<TState>[];
  initial_state: TState | (() => TState);
  metadata?: AgentRuntimeMetadata;
}

export interface RunAgentStreamOptions {
  run_id?: string;
  signal?: AbortSignal;
  now?: () => string;
  metadata?: AgentRuntimeMetadata;
}

const createAgentError = (
  error: unknown,
  code = "agent_runtime_error",
): AgentError => {
  const resolvedCode = error instanceof Error && error.name ? error.name : code;
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: resolvedCode,
    message: message.trim().length > 0 ? message : "Agent runtime error",
    recoverable: false,
    details: {},
  };
};

const isAsyncIterable = <T>(value: unknown): value is AsyncIterable<T> => {
  if (typeof value !== "object" || value === null) return false;
  const maybeIterable = value as { [Symbol.asyncIterator]?: unknown };
  return typeof maybeIterable[Symbol.asyncIterator] === "function";
};

const resolveInitialState = <TState>(
  initialState: TState | (() => TState),
): TState =>
  typeof initialState === "function"
    ? (initialState as () => TState)()
    : initialState;

const defaultRunId = () =>
  `agent-run-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

export async function* runAgentStream<TState>(
  task: AgentTaskDefinition<TState>,
  options: RunAgentStreamOptions = {},
): AsyncGenerator<AgentRunEvent> {
  const runId = options.run_id ?? defaultRunId();
  const now = options.now ?? (() => new Date().toISOString());
  let seq = 0;
  let usage: AgentRuntimeUsage = {};
  let finishReason: string | null = null;
  let finalStatus: AgentTerminalRunStatus = "completed";
  const artifactIds: string[] = [];

  const buildEvent = (event: AgentRunEventInput): AgentRunEvent =>
    AgentRunEventSchema.parse({
      ...event,
      event_id: `${runId}:event:${seq}`,
      run_id: runId,
      task_id: task.task_id,
      seq: seq++,
      created_at: now(),
    });

  const emitArtifact = (
    artifact: AgentArtifact,
    metadata: AgentRuntimeMetadata = {},
  ) => {
    artifactIds.push(artifact.artifact_id);
    return buildEvent({ type: "artifact.final", artifact, metadata });
  };
  const buildRuntimeEmission = (event: AgentRuntimeEmission) =>
    event.type === "artifact.final"
      ? emitArtifact(
          AgentArtifactSchema.parse(event.artifact),
          event.metadata ?? {},
        )
      : buildEvent(event);

  const runSpan = tracer.startSpan("reef.agent.run", {
    attributes: {
      "reef.agent.run_id": runId,
      "reef.agent.task_id": task.task_id,
    },
  });

  try {
    if (options.signal?.aborted) {
      yield buildEvent({
        type: "run.cancelled",
        run_status: "cancelled",
        reason: "aborted",
        metadata: options.metadata ?? {},
      });
      return;
    }

    yield buildEvent({
      type: "run.started",
      run_status: "running",
      input: { ...(task.metadata ?? {}), ...(options.metadata ?? {}) },
    });

    let state: TState;
    try {
      state = resolveInitialState(task.initial_state);
    } catch (error) {
      const agentError = createAgentError(error);
      yield buildEvent({
        type: "run.error",
        run_status: "error",
        error: agentError,
      });
      runSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: agentError.message,
      });
      return;
    }

    for (const stage of task.stages) {
      if (options.signal?.aborted) {
        yield buildEvent({
          type: "run.cancelled",
          run_status: "cancelled",
          reason: "aborted",
        });
        return;
      }

      const stageSpan = tracer.startSpan("reef.agent.stage", {
        attributes: {
          "reef.agent.run_id": runId,
          "reef.agent.task_id": task.task_id,
          "reef.agent.stage_id": stage.stage_id,
        },
      });
      const emitted: AgentRuntimeEmission[] = [];
      const context: AgentStageExecutionContext<TState> = {
        run_id: runId,
        task_id: task.task_id,
        stage_id: stage.stage_id,
        signal: options.signal,
        state,
        emit: (event) => emitted.push(event),
      };

      yield buildEvent({
        type: "stage.started",
        stage: { stage_id: stage.stage_id, name: stage.name ?? stage.stage_id },
      });

      try {
        const stageRun = stage.run(context);
        let result: AgentStageResult<TState> = {};

        if (isAsyncIterable<AgentStageEmission<TState>>(stageRun)) {
          for await (const emission of stageRun) {
            if (options.signal?.aborted) {
              yield buildEvent({
                type: "run.cancelled",
                run_status: "cancelled",
                reason: "aborted",
              });
              return;
            }
            for (const event of emitted.splice(0)) {
              yield buildRuntimeEmission(event);
            }
            if (emission.type === "event") {
              yield buildRuntimeEmission(emission.event);
            } else {
              result = { ...result, ...emission.result };
            }
          }
          for (const event of emitted.splice(0)) {
            yield buildRuntimeEmission(event);
          }
        } else {
          result = await stageRun;
          for (const event of emitted) {
            yield buildRuntimeEmission(event);
          }
        }

        if (result.state !== undefined) state = result.state;
        if (result.usage) usage = { ...usage, ...result.usage };
        if (result.finish_reason !== undefined) {
          finishReason = result.finish_reason;
        }
        if (result.final_status) finalStatus = result.final_status;

        for (const artifact of result.artifacts ?? []) {
          yield emitArtifact(AgentArtifactSchema.parse(artifact));
        }

        yield buildEvent({
          type: "stage.completed",
          stage: {
            stage_id: stage.stage_id,
            name: stage.name ?? stage.stage_id,
          },
          output: {
            ...(result.output ?? {}),
            ...(result.finish_reason !== undefined
              ? { finish_reason: result.finish_reason }
              : {}),
          },
        });
        stageSpan.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        const agentError = createAgentError(error);
        stageSpan.recordException(error as Error);
        stageSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: agentError.message,
        });
        for (const event of emitted.splice(0)) {
          yield buildRuntimeEmission(event);
        }
        yield buildEvent({
          type: "stage.error",
          stage: {
            stage_id: stage.stage_id,
            name: stage.name ?? stage.stage_id,
          },
          error: agentError,
        });
        yield buildEvent({
          type: "run.error",
          run_status: "error",
          error: agentError,
        });
        runSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: agentError.message,
        });
        return;
      } finally {
        stageSpan.end();
      }
    }

    if (finalStatus === "empty") {
      yield buildEvent({
        type: "run.empty",
        run_status: "empty",
        reason: finishReason,
      });
      return;
    }

    yield buildEvent({
      type: "run.completed",
      run_status: AgentRunStatusEnum.enum.completed,
      artifact_ids: artifactIds,
      usage,
      metadata: finishReason ? { finish_reason: finishReason } : {},
    });
    runSpan.setStatus({ code: SpanStatusCode.OK });
  } finally {
    runSpan.end();
  }
}

export async function collectAgentResult(
  events: AsyncIterable<AgentRunEvent>,
): Promise<AgentRunEnvelope> {
  const collectedEvents: AgentRunEvent[] = [];
  const artifacts: AgentArtifact[] = [];
  let runId: string | null = null;
  let taskId: string | null = null;
  let status: AgentRunStatus = "running";
  let startedAt: string | null = null;
  let completedAt: string | null = null;
  let input: AgentRuntimeMetadata = {};
  let error: AgentError | null = null;
  let metadata: AgentRuntimeMetadata = {};

  for await (const rawEvent of events) {
    const event = AgentRunEventSchema.parse(rawEvent);
    collectedEvents.push(event);
    runId ??= event.run_id;
    taskId ??= event.task_id;
    startedAt ??= event.created_at;

    if (event.type === "run.started") {
      input = event.input;
    }
    if (event.type === "artifact.final") {
      artifacts.push(event.artifact);
    }
    if (
      event.type === "run.completed" ||
      event.type === "run.empty" ||
      event.type === "run.cancelled" ||
      event.type === "run.error"
    ) {
      status = event.run_status;
      completedAt = event.created_at;
      if (event.type === "run.error") {
        error = event.error;
      }
      if (event.type === "run.completed") {
        metadata = {
          ...metadata,
          usage: event.usage,
          ...event.metadata,
        };
      }
    }
  }

  return AgentRunEnvelopeSchema.parse({
    run_id: runId ?? "unknown-run",
    task_id: taskId ?? "unknown-task",
    status,
    started_at: startedAt ?? new Date(0).toISOString(),
    completed_at: completedAt,
    input,
    events: collectedEvents,
    artifacts,
    error,
    metadata,
  });
}
