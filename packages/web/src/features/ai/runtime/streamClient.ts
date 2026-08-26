"use client";

import { apiFetch } from "@/lib/apiClient";
import {
  type AgentRunEvent,
  AgentRunEventSchema,
  type AgentRunRequest,
} from "@reef/core";
import { parseJsonEventStream } from "ai";
import {
  agentRunReducer,
  createInitialAgentRunState,
  isTerminalPhase,
} from "./reducer";
import type { AgentRunFailure, AgentRunFetch, AgentRunState } from "./types";

const AGENT_RUNS_ENDPOINT = "/api/agents/runs";

export class AgentRunClientError extends Error {
  readonly failure: AgentRunFailure;

  constructor(failure: AgentRunFailure) {
    super(failure.message);
    this.name = "AgentRunClientError";
    this.failure = failure;
  }
}

export interface StreamAgentRunOptions {
  fetch?: AgentRunFetch;
  signal?: AbortSignal;
  onEvent?: (event: AgentRunEvent, state: AgentRunState) => void;
}

export async function streamAgentRun(
  request: AgentRunRequest,
  options: StreamAgentRunOptions = {},
): Promise<AgentRunState> {
  const fetcher = options.fetch ?? apiFetch;
  const response = await fetcher(AGENT_RUNS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new AgentRunClientError(await httpFailure(response));
  }

  let state = createInitialAgentRunState(request.task_id);
  let terminalReceived = false;
  for await (const event of readAgentRunEvents(response)) {
    state = agentRunReducer(state, { type: "event", event });
    terminalReceived = terminalReceived || isTerminalPhase(state.phase);
    options.onEvent?.(event, state);
  }
  if (!terminalReceived) {
    throw new AgentRunClientError(
      streamFailure("Agent run stream ended before a terminal event.", {
        phase: state.phase,
        run_id: state.run_id,
        task_id: state.task_id,
        seq: state.seq,
      }),
    );
  }
  return state;
}

export async function* readAgentRunEvents(
  response: Response,
): AsyncGenerator<AgentRunEvent> {
  if (!response.body) {
    throw new AgentRunClientError(
      streamFailure("Agent run response did not include a stream."),
    );
  }
  const reader = parseJsonEventStream({
    stream: response.body,
    schema: AgentRunEventSchema,
  }).getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (!value.success) {
        throw new AgentRunClientError(
          streamFailure("Agent run stream contained an invalid event.", {
            validation: value.error.message,
          }),
        );
      }
      yield value.value;
    }
  } catch (error) {
    if (error instanceof AgentRunClientError) throw error;
    throw new AgentRunClientError(
      streamFailure(
        error instanceof Error
          ? error.message
          : "Agent run stream could not be parsed.",
      ),
    );
  } finally {
    reader.releaseLock();
  }
}

export function agentRunFailureFromUnknown(error: unknown): AgentRunFailure {
  if (error instanceof AgentRunClientError) return error.failure;
  if (isAbortError(error)) {
    return {
      kind: "cancelled",
      code: "agent_run_cancelled",
      message: "Agent run was cancelled.",
      recoverable: true,
      details: {},
    };
  }
  return streamFailure(
    error instanceof Error ? error.message : "Agent run stream failed.",
  );
}

async function httpFailure(response: Response): Promise<AgentRunFailure> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    runtime_error?: {
      code?: string;
      message?: string;
      recoverable?: boolean;
      details?: Record<string, unknown>;
    };
  };
  const runtimeError = body.runtime_error;
  return {
    kind: "http",
    code: runtimeError?.code ?? `http_${response.status}`,
    message:
      runtimeError?.message ??
      body.error ??
      `Agent run request failed (HTTP ${response.status}).`,
    recoverable: runtimeError?.recoverable ?? response.status >= 500,
    status: response.status,
    details: runtimeError?.details ?? {},
  };
}

function streamFailure(
  message: string,
  details: Record<string, unknown> = {},
): AgentRunFailure {
  return {
    kind: "stream",
    code: "agent_run_stream_parse_error",
    message,
    recoverable: true,
    details,
  };
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}
