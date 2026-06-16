"use client";

import type { AgentRunRequest } from "@reef/core";
import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import { agentRunReducer, createInitialAgentRunState } from "./reducer";
import {
  type StreamAgentRunOptions,
  agentRunFailureFromUnknown,
  streamAgentRun,
} from "./streamClient";
import type { AgentRunFetch, AgentRunState } from "./types";

export interface UseAgentRunOptions {
  fetch?: AgentRunFetch;
  onEvent?: StreamAgentRunOptions["onEvent"];
}

export interface UseAgentRunResult {
  state: AgentRunState;
  start: (request: AgentRunRequest) => Promise<AgentRunState>;
  cancel: (reason?: string) => void;
  retry: () => Promise<AgentRunState | null>;
  canCancel: boolean;
  canRetry: boolean;
  isRunning: boolean;
}

export function useAgentRun(
  options: UseAgentRunOptions = {},
): UseAgentRunResult {
  const [state, dispatch] = useReducer(
    agentRunReducer,
    null,
    createInitialAgentRunState,
  );
  const fetcher = options.fetch;
  const onEvent = options.onEvent;
  const abortRef = useRef<AbortController | null>(null);
  const activeRunRef = useRef<symbol | null>(null);
  const lastRequestRef = useRef<AgentRunRequest | null>(null);
  const [hasLastRequest, setHasLastRequest] = useState(false);

  const start = useCallback(
    async (request: AgentRunRequest): Promise<AgentRunState> => {
      const runToken = Symbol("agent-run");
      activeRunRef.current = runToken;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      lastRequestRef.current = request;
      setHasLastRequest(true);
      dispatch({ type: "reset", task_id: request.task_id });
      const isActiveRun = () => activeRunRef.current === runToken;

      try {
        const finalState = await streamAgentRun(request, {
          ...(fetcher ? { fetch: fetcher } : {}),
          signal: controller.signal,
          onEvent: (event, nextState) => {
            if (!isActiveRun()) return;
            dispatch({ type: "event", event });
            onEvent?.(event, nextState);
          },
        });
        return finalState;
      } catch (err) {
        if (!isActiveRun()) throw err;
        const failure = agentRunFailureFromUnknown(err);
        if (failure.kind === "cancelled") {
          dispatch({ type: "cancelled", reason: failure.message });
        } else if (failure.kind === "http") {
          dispatch({ type: "http_error", error: failure });
        } else {
          dispatch({ type: "stream_error", error: failure });
        }
        throw err;
      } finally {
        if (isActiveRun()) {
          activeRunRef.current = null;
        }
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [fetcher, onEvent],
  );

  const cancel = useCallback((reason = "Agent run was cancelled.") => {
    const controller = abortRef.current;
    activeRunRef.current = null;
    abortRef.current = null;
    controller?.abort();
    dispatch({ type: "cancelled", reason });
  }, []);

  const retry = useCallback(async () => {
    if (!lastRequestRef.current) return null;
    return start(lastRequestRef.current);
  }, [start]);

  const isRunning = state.phase === "running";

  return useMemo(
    () => ({
      state,
      start,
      cancel,
      retry,
      canCancel: isRunning,
      canRetry: !isRunning && hasLastRequest,
      isRunning,
    }),
    [state, start, cancel, retry, isRunning, hasLastRequest],
  );
}
