import type { ChatAssistantTurn } from "@/features/ai/chat/chatTypes";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWorkspaceChat } from "./useWorkspaceChat";

// A frame carries an agent-run event; the client parses `data:` SSE lines.
function baseEvent(seq: number, type: string, extra: Record<string, unknown>) {
  return {
    event_id: `r:${seq}`,
    run_id: "r",
    task_id: "chat.workspace",
    seq,
    created_at: "2026-07-03T00:00:00.000Z",
    metadata: {},
    type,
    ...extra,
  };
}

function sseResponse(events: Record<string, unknown>[], keepOpen = false) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      }
      if (!keepOpen) controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const HAPPY_EVENTS = [
  baseEvent(0, "run.started", { run_status: "running", input: {} }),
  baseEvent(1, "tool.called", {
    tool: { tool_call_id: "c1", tool_name: "search_issues" },
    input: { query: "login" },
  }),
  baseEvent(2, "model.delta", { delta: "Found ", channel: "text" }),
  baseEvent(3, "tool.completed", {
    tool: { tool_call_id: "c1", tool_name: "search_issues" },
    output: { issues: [{ id: "REEF-1" }] },
  }),
  baseEvent(4, "model.delta", { delta: "REEF-1.", channel: "text" }),
  baseEvent(5, "run.completed", {
    run_status: "completed",
    artifact_ids: [],
    usage: {},
  }),
];

function assistant(turn: { role: string } | undefined): ChatAssistantTurn {
  if (!turn || turn.role !== "assistant") throw new Error("expected assistant");
  return turn as ChatAssistantTurn;
}

describe("useWorkspaceChat", () => {
  it("commits a user + assistant turn with tool steps and text (AC1/AC2)", async () => {
    const fetch = () => Promise.resolve(sseResponse(HAPPY_EVENTS));
    const { result } = renderHook(() =>
      useWorkspaceChat({ fetch, route: null, reefId: null }),
    );

    act(() => {
      result.current.sendMessage({ text: "any login issues?" });
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: "user",
      text: "any login issues?",
    });

    const turn = assistant(result.current.messages[1]);
    expect(turn.text).toBe("Found REEF-1.");
    expect(turn.streaming).toBe(false);
    expect(turn.errorMessage).toBeNull();
    expect(turn.toolSteps).toHaveLength(1);
    expect(turn.toolSteps[0]).toMatchObject({
      toolName: "search_issues",
      status: "completed",
    });
    // The issue the search surfaced is available for deep-linking (AC3).
    expect(turn.referencedIssueIds).toContain("REEF-1");
  });

  it("commits an assistant turn carrying the error when the run fails", async () => {
    const fetch = () =>
      Promise.resolve(
        Response.json({ error: "AI unavailable" }, { status: 503 }),
      );
    const { result } = renderHook(() =>
      useWorkspaceChat({ fetch, route: null, reefId: null }),
    );

    act(() => {
      result.current.sendMessage({ text: "hi" });
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.messages).toHaveLength(2);
    const turn = assistant(result.current.messages[1]);
    expect(turn.errorMessage).toBeTruthy();
  });

  it("clear() resets the conversation", async () => {
    const fetch = () => Promise.resolve(sseResponse(HAPPY_EVENTS));
    const { result } = renderHook(() =>
      useWorkspaceChat({ fetch, route: null, reefId: null }),
    );

    act(() => {
      result.current.sendMessage({ text: "q" });
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    act(() => {
      result.current.clear();
    });
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.messageCount).toBe(0);
  });
});
