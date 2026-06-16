import type { AgentRunEvent } from "@reef/core";
import type {
  AgentRunFailure,
  AgentRunPhase,
  AgentRunReducerAction,
  AgentRunState,
} from "./types";

export function createInitialAgentRunState(
  taskId: AgentRunState["task_id"] = null,
): AgentRunState {
  return {
    phase: "idle",
    run_status: null,
    run_id: null,
    task_id: taskId,
    seq: 0,
    started_at: null,
    updated_at: null,
    completed_at: null,
    text: "",
    events: [],
    progress: { stages: {}, tools: {} },
    partial_artifacts: {},
    artifacts: {},
    artifact_order: [],
    artifact_ids: [],
    error: null,
  };
}

export function agentRunReducer(
  state: AgentRunState,
  action: AgentRunReducerAction,
): AgentRunState {
  if (action.type === "reset") {
    return createInitialAgentRunState(action.task_id ?? null);
  }

  if (action.type === "stream_error" || action.type === "http_error") {
    return {
      ...state,
      phase: "error",
      run_status: "error",
      error: action.error,
    };
  }

  if (action.type === "cancelled") {
    return {
      ...state,
      phase: "cancelled",
      run_status: "cancelled",
      error: {
        kind: "cancelled",
        code: "agent_run_cancelled",
        message: action.reason ?? "Agent run was cancelled.",
        recoverable: true,
        details: {},
      },
    };
  }

  return reduceAgentRunEvent(state, action.event);
}

function reduceAgentRunEvent(
  state: AgentRunState,
  event: AgentRunEvent,
): AgentRunState {
  const base = applyEventBase(state, event);

  switch (event.type) {
    case "run.started":
      return {
        ...base,
        phase: "running",
        run_status: event.run_status,
        started_at: event.created_at,
        error: null,
      };
    case "run.completed":
      return {
        ...base,
        phase: "completed",
        run_status: event.run_status,
        completed_at: event.created_at,
        artifact_ids: event.artifact_ids,
      };
    case "run.empty":
      return {
        ...base,
        phase: "empty",
        run_status: event.run_status,
        completed_at: event.created_at,
      };
    case "run.cancelled":
      return {
        ...base,
        phase: "cancelled",
        run_status: event.run_status,
        completed_at: event.created_at,
        error: {
          kind: "cancelled",
          code: "agent_run_cancelled",
          message: event.reason ?? "Agent run was cancelled.",
          recoverable: true,
          details: {},
        },
      };
    case "run.error":
      return {
        ...base,
        phase: "error",
        run_status: event.run_status,
        completed_at: event.created_at,
        error: runtimeFailure(event.error),
      };
    case "stage.started":
      return {
        ...base,
        progress: {
          ...base.progress,
          stages: {
            ...base.progress.stages,
            [event.stage.stage_id]: {
              stage_id: event.stage.stage_id,
              name: event.stage.name,
              status: "running",
              output: null,
              error: null,
              updated_at: event.created_at,
            },
          },
        },
      };
    case "stage.completed":
      return {
        ...base,
        progress: {
          ...base.progress,
          stages: {
            ...base.progress.stages,
            [event.stage.stage_id]: {
              stage_id: event.stage.stage_id,
              name: event.stage.name,
              status: "completed",
              output: event.output,
              error: null,
              updated_at: event.created_at,
            },
          },
        },
      };
    case "stage.error":
      return {
        ...base,
        progress: {
          ...base.progress,
          stages: {
            ...base.progress.stages,
            [event.stage.stage_id]: {
              stage_id: event.stage.stage_id,
              name: event.stage.name,
              status: "error",
              output: null,
              error: event.error,
              updated_at: event.created_at,
            },
          },
        },
      };
    case "tool.called":
      return {
        ...base,
        progress: {
          ...base.progress,
          tools: {
            ...base.progress.tools,
            [event.tool.tool_call_id]: {
              tool_call_id: event.tool.tool_call_id,
              tool_name: event.tool.tool_name,
              status: "called",
              input: event.input,
              output: null,
              error: null,
              updated_at: event.created_at,
            },
          },
        },
      };
    case "tool.completed":
      return {
        ...base,
        progress: {
          ...base.progress,
          tools: {
            ...base.progress.tools,
            [event.tool.tool_call_id]: {
              tool_call_id: event.tool.tool_call_id,
              tool_name: event.tool.tool_name,
              status: "completed",
              input:
                base.progress.tools[event.tool.tool_call_id]?.input ?? null,
              output: event.output,
              error: null,
              updated_at: event.created_at,
            },
          },
        },
      };
    case "tool.error":
      return {
        ...base,
        progress: {
          ...base.progress,
          tools: {
            ...base.progress.tools,
            [event.tool.tool_call_id]: {
              tool_call_id: event.tool.tool_call_id,
              tool_name: event.tool.tool_name,
              status: "error",
              input:
                base.progress.tools[event.tool.tool_call_id]?.input ?? null,
              output: null,
              error: event.error,
              updated_at: event.created_at,
            },
          },
        },
      };
    case "model.delta":
      return {
        ...base,
        text:
          event.channel === "text" ? `${base.text}${event.delta}` : base.text,
      };
    case "artifact.partial":
      return {
        ...base,
        partial_artifacts: {
          ...base.partial_artifacts,
          [event.artifact_id]: {
            artifact_id: event.artifact_id,
            artifact_type: event.artifact_type,
            deltas: [
              ...(base.partial_artifacts[event.artifact_id]?.deltas ?? []),
              event.delta,
            ],
            updated_at: event.created_at,
          },
        },
      };
    case "artifact.final": {
      const alreadySeen = event.artifact.artifact_id in base.artifacts;
      const { [event.artifact.artifact_id]: _removed, ...remainingPartials } =
        base.partial_artifacts;
      return {
        ...base,
        artifacts: {
          ...base.artifacts,
          [event.artifact.artifact_id]: event.artifact,
        },
        artifact_order: alreadySeen
          ? base.artifact_order
          : [...base.artifact_order, event.artifact.artifact_id],
        partial_artifacts: remainingPartials,
      };
    }
    case "repair.started":
    case "repair.completed":
    case "repair.failed":
      return base;
    default:
      return assertNever(event);
  }
}

export function isTerminalPhase(phase: AgentRunPhase): boolean {
  return (
    phase === "completed" ||
    phase === "empty" ||
    phase === "error" ||
    phase === "cancelled"
  );
}

function applyEventBase(
  state: AgentRunState,
  event: AgentRunEvent,
): AgentRunState {
  return {
    ...state,
    run_id: event.run_id,
    task_id: event.task_id,
    seq: event.seq,
    updated_at: event.created_at,
    events: [...state.events, event],
  };
}

function runtimeFailure(
  error: Extract<AgentRunEvent, { type: "run.error" }>["error"],
) {
  return {
    kind: "runtime",
    code: error.code,
    message: error.message,
    recoverable: error.recoverable,
    details: error.details,
  } satisfies AgentRunFailure;
}

function assertNever(value: never): AgentRunState {
  throw new Error(`Unhandled agent run event: ${JSON.stringify(value)}`);
}
