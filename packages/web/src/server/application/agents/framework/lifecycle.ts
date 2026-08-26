import {
  type AgentError,
  type AgentRunEvent,
  AgentRunEventSchema,
} from "./events";

type EventBaseKey =
  | "event_id"
  | "run_id"
  | "task_id"
  | "seq"
  | "created_at"
  | "metadata";

export type AgentRunEventInput = AgentRunEvent extends infer Event
  ? Event extends AgentRunEvent
    ? Omit<Event, EventBaseKey> & {
        metadata?: Record<string, unknown>;
      }
    : never
  : never;

export interface AgentRunLifecycle {
  readonly runId: string;
  emit: (event: AgentRunEventInput) => AgentRunEvent;
  start: (input?: Record<string, unknown>) => AgentRunEvent;
  complete: (options?: {
    artifactIds?: string[];
    usage?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }) => AgentRunEvent | null;
  empty: (reason?: string | null) => AgentRunEvent | null;
  fail: (error: unknown, code?: string) => AgentRunEvent | null;
}

export function createAgentRunLifecycle({
  taskId,
  runId = createRunId(taskId),
  metadata = {},
  onEvent,
  now = () => new Date().toISOString(),
}: {
  taskId: string;
  runId?: string;
  metadata?: Record<string, unknown>;
  onEvent?: (event: AgentRunEvent) => void;
  now?: () => string;
}): AgentRunLifecycle {
  let seq = 0;
  let terminal = false;

  const emit = (input: AgentRunEventInput): AgentRunEvent => {
    const event = AgentRunEventSchema.parse({
      ...input,
      event_id: `${runId}:${seq}`,
      run_id: runId,
      task_id: taskId,
      seq: seq++,
      created_at: now(),
      metadata: { ...metadata, ...(input.metadata ?? {}) },
    });
    onEvent?.(event);
    return event;
  };

  const emitTerminal = (input: AgentRunEventInput): AgentRunEvent | null => {
    if (terminal) return null;
    terminal = true;
    return emit(input);
  };

  return {
    runId,
    emit,
    start: (input = {}) =>
      emit({ type: "run.started", run_status: "running", input }),
    complete: (options = {}) =>
      emitTerminal({
        type: "run.completed",
        run_status: "completed",
        artifact_ids: options.artifactIds ?? [],
        usage: options.usage ?? {},
        metadata: options.metadata,
      }),
    empty: (reason = null) =>
      emitTerminal({ type: "run.empty", run_status: "empty", reason }),
    fail: (error, code = "agent_run_failed") =>
      emitTerminal({
        type: "run.error",
        run_status: "error",
        error: agentErrorFromUnknown(error, code),
      }),
  };
}

export function agentErrorFromUnknown(
  error: unknown,
  code = "agent_run_failed",
): AgentError {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code,
    message: message.trim() || "Agent run failed.",
    recoverable: false,
    details: {},
  };
}

function createRunId(taskId: string): string {
  return `${taskId}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
