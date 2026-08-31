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
import type { IssueCreateInput } from "@reef/core";
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
  /** Latest unsaved New Issue fields/body, read at each send. */
  draft?: IssueCreateInput | null;
  /** Identity of the conversation owner; changing it clears all chat state. */
  scopeKey?: string | null;
}

export interface UseWorkspaceChatResult {
  messages: ChatTurn[];
  /** Resolves true when the run completed; false keeps the composer for retry. */
  sendMessage: (input: { text: string }) => Promise<boolean>;
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
  const { state: runState, start, cancel } = agentRun;

  const [turns, setTurns] = useState<ChatTurn[]>([]);

  const [assistantId, setAssistantId] = useState<string | null>(null);
  const idCounter = useRef(0);
  const sendingRef = useRef(false);
  const nextId = useCallback(
    (prefix: string) => `${prefix}-${idCounter.current++}`,
    [],
  );

  const runActive = assistantId !== null && !isTerminalPhase(runState.phase);

  const currentAssistantTurn = useMemo<ChatAssistantTurn | null>(() => {
    if (!assistantId) return null;
    return assistantTurnFrom(assistantId, runState, runActive);
  }, [assistantId, runActive, runState]);

  const messages = useMemo<ChatTurn[]>(
    () => (currentAssistantTurn ? [...turns, currentAssistantTurn] : turns),
    [turns, currentAssistantTurn],
  );

  const sendMessage = useCallback(
    async ({ text }: { text: string }): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed || runActive || sendingRef.current) return false;
      sendingRef.current = true;
      const userTurn: ChatTurn = {
        id: nextId("user"),
        role: "user",
        text: trimmed,
      };
      const history = [...messages, userTurn];
      setTurns(history);
      setAssistantId(nextId("assistant"));
      try {
        await start(
          chatWorkspaceRun({
            messages: history.map(toRequestMessage),
            route: options.route,
            reefId: options.reefId,
            ...(options.draft ? { draft: options.draft } : {}),
          }),
        );
        return true;
      } catch {
        // A final error / cancel is already reflected in run state. Returning
        // false keeps the submitted text in the composer for a retry.
        return false;
      } finally {
        sendingRef.current = false;
      }
    },
    [
      messages,
      nextId,
      options.draft,
      options.reefId,
      options.route,
      runActive,
      start,
    ],
  );

  const stop = useCallback(() => {
    sendingRef.current = false;
    cancel();
  }, [cancel]);

  const clear = useCallback(() => {
    sendingRef.current = false;
    cancel();
    setAssistantId(null);
    setTurns([]);
  }, [cancel]);

  const scopeKeyRef = useRef(options.scopeKey ?? null);
  useEffect(() => {
    const nextScopeKey = options.scopeKey ?? null;
    if (scopeKeyRef.current === nextScopeKey) return;
    scopeKeyRef.current = nextScopeKey;
    clear();
  }, [clear, options.scopeKey]);

  const status: ChatStatus = runActive
    ? runState.phase === "running"
      ? "streaming"
      : "submitted"
    : runState.phase === "error"
      ? "error"
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
