import type { ChatAssistantTurn } from "@/features/ai/chat/chatTypes";
import type { IssueCreateInput } from "@reef/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

const FIRST_DRAFT = {
  fields: { title: "First draft", issue_type: "story" as const },
  content: "First body",
} satisfies IssueCreateInput;

const SECOND_DRAFT = {
  fields: {
    title: "Updated draft",
    issue_type: "story" as const,
    priority: "high" as const,
    labels: ["latest"],
  },
  content: "Updated body after the first answer.",
} satisfies IssueCreateInput;

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

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.messages).toHaveLength(2);
    const turn = assistant(result.current.messages[1]);
    expect(turn.errorMessage).toBeTruthy();
  });

  it("sends the latest draft together with the complete prior conversation", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetch = (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Promise.resolve(sseResponse(HAPPY_EVENTS));
    };
    const { result, rerender } = renderHook(
      ({ draft, scopeKey }: { draft: IssueCreateInput; scopeKey: string }) =>
        useWorkspaceChat({
          fetch,
          route: null,
          reefId: null,
          draft,
          scopeKey,
        }),
      { initialProps: { draft: FIRST_DRAFT, scopeKey: "draft-1" } },
    );

    await act(async () => {
      await result.current.sendMessage({ text: "First question" });
    });
    rerender({ draft: SECOND_DRAFT, scopeKey: "draft-1" });
    await act(async () => {
      await result.current.sendMessage({ text: "Use my changes" });
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      input: { draft: FIRST_DRAFT },
    });
    expect(requests[1]).toMatchObject({
      input: {
        draft: SECOND_DRAFT,
        messages: [
          { role: "user", parts: [{ text: "First question" }] },
          { role: "assistant", parts: [{ text: "Found REEF-1." }] },
          { role: "user", parts: [{ text: "Use my changes" }] },
        ],
      },
    });
  });

  it("keeps a partial assistant answer after the user stops the run", async () => {
    let signal: AbortSignal | null | undefined;
    const fetch = (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      signal = init?.signal;
      const encoder = new TextEncoder();
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify(
                    baseEvent(0, "run.started", {
                      run_status: "running",
                      input: {},
                    }),
                  )}\n\n`,
                ),
              );
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify(
                    baseEvent(1, "model.delta", {
                      delta: "Partial answer",
                      channel: "text",
                    }),
                  )}\n\n`,
                ),
              );
              signal?.addEventListener("abort", () => {
                controller.error(new DOMException("Aborted", "AbortError"));
              });
            },
          }),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      );
    };
    const { result } = renderHook(() =>
      useWorkspaceChat({ fetch, route: null, reefId: null }),
    );

    let send: Promise<boolean> | undefined;
    act(() => {
      send = result.current.sendMessage({ text: "stop now" });
    });
    await waitFor(() => expect(result.current.messages[1]).toBeDefined());
    act(() => result.current.stop());
    await act(async () => {
      await send;
    });

    expect(signal?.aborted).toBe(true);
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({
      role: "assistant",
      text: "Partial answer",
      streaming: false,
      errorMessage: null,
    });
  });

  it("clears a draft conversation on scope change and ignores its late response", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(sseResponse(HAPPY_EVENTS));
    const { result, rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) =>
        useWorkspaceChat({
          fetch,
          route: null,
          reefId: null,
          draft: FIRST_DRAFT,
          scopeKey,
        }),
      { initialProps: { scopeKey: "reef-a:draft-1" } },
    );

    let firstSend: Promise<boolean> | undefined;
    act(() => {
      firstSend = result.current.sendMessage({ text: "old workspace" });
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    rerender({ scopeKey: "reef-b:draft-1" });
    await waitFor(() => expect(result.current.messages).toHaveLength(0));

    resolveFirst?.(sseResponse(HAPPY_EVENTS));
    await act(async () => {
      await firstSend;
    });
    expect(result.current.messages).toHaveLength(0);

    await act(async () => {
      await result.current.sendMessage({ text: "new workspace" });
    });
    expect(result.current.messages[0]).toMatchObject({
      role: "user",
      text: "new workspace",
    });
    expect(result.current.messages).not.toContainEqual(
      expect.objectContaining({ text: "old workspace" }),
    );
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
