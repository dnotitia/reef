"use client";

import type {
  ChatAssistantTurn,
  ChatToolStep,
  ChatTurn,
} from "@/features/ai/chat/chatTypes";
import type { IssueCreateInput } from "@reef/core";
import {
  collectReferencedIssueIds,
  extractChatCitations,
} from "@/lib/ai/chatToolSummary";
import { useCallback, useMemo, useRef, useState } from "react";
import { isTerminalPhase } from "../runtime/reducer";
import { chatWorkspaceRun } from "../runtime/taskRequests";
import type {
  AgentRunFetch,
  AgentRunState,
  AgentRunToolState,
} from "../runtime/types";
import { useAgentRun } from "../runtime/useAgentRun";

/** Same status vocabulary the composer's submit button consumes. */
export type ChatStatus = "submitted" | "streaming" | "ready";

export interface UseWorkspaceChatOptions {
  /** Vault-aware fetch (adds the workspace header); defaults to apiFetch. */
  fetch?: AgentRunFetch;
  /** Grounding hints read at send time (REEF-360): current route + open issue. */
  route: string | null;
  reefId: string | null;
  /** Latest credential-free New Issue snapshot, read at send/retry time. */
  draft?: IssueCreateInput | null;
}

export interface UseWorkspaceChatResult {
  messages: ChatTurn[];
  sendMessage: (input: { text: string }) => void;
  status: ChatStatus;
  /** Aborts an in-flight run, keeping the partial answer + steps. */
  stop: () => void;
  /** Resets the conversation (new chat). */
  clear: () => void;
  /** Retries the failed turn with the current draft snapshot. */
  retry: () => void;
  messageCount: number;
}

function toolStepsFrom(
  tools: Record<string, AgentRunToolState>,
): ChatToolStep[] {
  // Object key order is insertion order for string keys, so the tools render in
  // call order.
  return Object.values(tools).map((tool) => ({
    toolCallId: tool.tool_call_id,
    toolName: tool.tool_name,
    status: tool.status === "called" ? "running" : tool.status,
    input: tool.input,
    output: tool.output,
    errorMessage: tool.error?.message ?? null,
  }));
}

function assistantTurnFrom(
  id: string,
  state: AgentRunState,
  streaming: boolean,
): ChatAssistantTurn {
  const toolSteps = toolStepsFrom(state.progress.tools);
  return {
    id,
    role: "assistant",
    text: state.text,
    toolSteps,
    citations: extractChatCitations(toolSteps),
    referencedIssueIds: collectReferencedIssueIds(toolSteps),
    streaming,
    // Cancellation (user stop) and empty runs are not failures — surface a
    // genuine error line.
    errorMessage:
      state.phase === "error" && state.error ? state.error.message : null,
  };
}

function toRequestMessage(turn: ChatTurn) {
  return {
    id: turn.id,
    role: turn.role,
    parts: [{ type: "text" as const, text: turn.text }],
  };
}

/**
 * The Ask AI conversation controller (REEF-361 AC1). Wraps the single-run
 * `useAgentRun` in a multi-turn conversation over the `chat.workspace`
 * agent-run task: each user message starts a run, the in-flight assistant turn
 * renders live from run state (streamed text + tool steps), and the finished
 * turn remains visible when the run reaches a final phase, so a cancelled or
 * failed run still keeps whatever answer and steps had streamed.
 */
export function useWorkspaceChat(
  options: UseWorkspaceChatOptions,
): UseWorkspaceChatResult {
  const agentRun = useAgentRun(options.fetch ? { fetch: options.fetch } : {});

  const [turns, setTurns] = useState<ChatTurn[]>([]);

  const [assistantId, setAssistantId] = useState<string | null>(null);
  const idCounter = useRef(0);
  // `useAgentRun` aborts an older stream when a new one starts, but the React
  // state update that marks a run active is asynchronous. This synchronous
  // token closes that same-tick window so two submits cannot overlap.
  const inFlightTokenRef = useRef<symbol | null>(null);
  const nextId = useCallback(
    (prefix: string) => `${prefix}-${idCounter.current++}`,
    [],
  );

  const runState = agentRun.state;
  const runActive = assistantId !== null && !isTerminalPhase(runState.phase);

  const currentAssistantTurn = useMemo<ChatAssistantTurn | null>(() => {
    if (!assistantId) return null;
    return assistantTurnFrom(assistantId, runState, runActive);
  }, [assistantId, runActive, runState]);

  const messages = useMemo<ChatTurn[]>(
    () => (currentAssistantTurn ? [...turns, currentAssistantTurn] : turns),
    [turns, currentAssistantTurn],
  );

  const requestFor = useCallback(
    (history: ChatTurn[]) =>
      chatWorkspaceRun({
        messages: history.map(toRequestMessage),
        route: options.route,
        reefId: options.reefId,
        ...(options.draft ? { draft: options.draft } : {}),
      }),
    [options.draft, options.reefId, options.route],
  );

  const startRequest = useCallback(
    (request: ReturnType<typeof requestFor>) => {
      if (inFlightTokenRef.current) return;
      const token = Symbol("workspace-chat-run");
      inFlightTokenRef.current = token;
      void agentRun
        .start(request)
        .catch(() => {
          // The run reducer already exposes the error to the assistant turn.
          // Swallow the rejected promise so a failed AI request never becomes
          // an unhandled rejection in the form surface.
        })
        .finally(() => {
          if (inFlightTokenRef.current === token) {
            inFlightTokenRef.current = null;
          }
        });
    },
    [agentRun],
  );

  const sendMessage = useCallback(
    ({ text }: { text: string }) => {
      const trimmed = text.trim();
      if (!trimmed || runActive || inFlightTokenRef.current) return;
      const userTurn: ChatTurn = {
        id: nextId("user"),
        role: "user",
        text: trimmed,
      };
      const history = [...messages, userTurn];
      setTurns(history);
      setAssistantId(nextId("assistant"));
      startRequest(requestFor(history));
    },
    [messages, nextId, requestFor, runActive, startRequest],
  );

  const retry = useCallback(() => {
    if (
      inFlightTokenRef.current ||
      runActive ||
      runState.phase !== "error" ||
      turns.length === 0
    ) {
      return;
    }
    // `turns` contains the failed user message but not the ephemeral failed
    // assistant turn, so retrying preserves the conversation without
    // duplicating the user's question.
    startRequest(requestFor(turns));
  }, [requestFor, runActive, runState.phase, startRequest, turns]);

  const stop = useCallback(() => {
    agentRun.cancel();
  }, [agentRun]);

  const clear = useCallback(() => {
    inFlightTokenRef.current = null;
    agentRun.cancel();
    setAssistantId(null);
    setTurns([]);
  }, [agentRun]);

  const status: ChatStatus = runActive
    ? runState.phase === "running"
      ? "streaming"
      : "submitted"
    : "ready";

  return {
    messages,
    sendMessage,
    status,
    stop,
    clear,
    retry,
    messageCount: messages.length,
  };
}
