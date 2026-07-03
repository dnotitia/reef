"use client";

import type {
  ChatAssistantTurn,
  ChatToolStep,
  ChatTurn,
} from "@/features/ai/chat/chatTypes";
import {
  collectReferencedIssueIds,
  extractChatCitations,
} from "@/lib/ai/chatToolSummary";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTerminalPhase } from "../runtime/reducer";
import { chatWorkspaceRun } from "../runtime/taskRequests";
import type {
  AgentRunFetch,
  AgentRunState,
  AgentRunToolState,
} from "../runtime/types";
import { useAgentRun } from "../runtime/useAgentRun";

/** Same status vocabulary the composer's submit button consumes. */
export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

export interface UseWorkspaceChatOptions {
  /** Vault-aware fetch (adds the workspace header); defaults to apiFetch. */
  fetch?: AgentRunFetch;
  /** Grounding hints read at send time (REEF-360): current route + open issue. */
  route: string | null;
  reefId: string | null;
}

export interface UseWorkspaceChatResult {
  messages: ChatTurn[];
  sendMessage: (input: { text: string }) => void;
  status: ChatStatus;
  /** Aborts an in-flight run, keeping the partial answer + steps. */
  stop: () => void;
  /** Resets the conversation (new chat). */
  clear: () => void;
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
    // Cancellation (user stop) and empty runs are not failures — only surface a
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
 * turn is committed to history when the run reaches a terminal phase — so a
 * cancelled or failed run still keeps whatever answer and steps had streamed.
 */
export function useWorkspaceChat(
  options: UseWorkspaceChatOptions,
): UseWorkspaceChatResult {
  const agentRun = useAgentRun(options.fetch ? { fetch: options.fetch } : {});

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [runActive, setRunActive] = useState(false);

  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const groundingRef = useRef({ route: options.route, reefId: options.reefId });
  groundingRef.current = { route: options.route, reefId: options.reefId };
  const assistantIdRef = useRef<string | null>(null);
  const idCounter = useRef(0);
  const nextId = useCallback(
    (prefix: string) => `${prefix}-${idCounter.current++}`,
    [],
  );

  const runState = agentRun.state;

  // The in-flight assistant turn, projected from live run state.
  const liveTurn = useMemo<ChatAssistantTurn | null>(() => {
    if (!runActive || !assistantIdRef.current) return null;
    return assistantTurnFrom(assistantIdRef.current, runState, true);
  }, [runActive, runState]);

  const messages = useMemo<ChatTurn[]>(
    () => (liveTurn ? [...turns, liveTurn] : turns),
    [turns, liveTurn],
  );

  // Commit the finished assistant turn when the run terminates (completed,
  // empty, error, or cancelled). Fires once per run: flipping runActive false
  // stops the condition from re-triggering.
  useEffect(() => {
    if (!runActive) return;
    if (!isTerminalPhase(runState.phase)) return;
    const id = assistantIdRef.current;
    if (!id) return;
    const committed = assistantTurnFrom(id, runState, false);
    assistantIdRef.current = null;
    setRunActive(false);
    setTurns((prev) => [...prev, committed]);
  }, [runActive, runState]);

  const sendMessage = useCallback(
    ({ text }: { text: string }) => {
      const trimmed = text.trim();
      if (!trimmed || runActive) return;
      const userTurn: ChatTurn = {
        id: nextId("user"),
        role: "user",
        text: trimmed,
      };
      const history = [...turnsRef.current, userTurn];
      setTurns(history);
      assistantIdRef.current = nextId("assistant");
      setRunActive(true);
      const { route, reefId } = groundingRef.current;
      void agentRun
        .start(
          chatWorkspaceRun({
            messages: history.map(toRequestMessage),
            route,
            reefId,
          }),
        )
        .catch(() => {
          // A terminal error / cancel is already reflected in run state; the
          // commit effect records the (partial) assistant turn. Swallow so the
          // rejected start() promise does not surface as unhandled.
        });
    },
    [agentRun, runActive, nextId],
  );

  const stop = useCallback(() => {
    agentRun.cancel();
  }, [agentRun]);

  const clear = useCallback(() => {
    agentRun.cancel();
    assistantIdRef.current = null;
    setRunActive(false);
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
    messageCount: messages.length,
  };
}
