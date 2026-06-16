import type { AgentRunEvent, AgentRunRequest } from "@reef/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAgentRun } from "./useAgentRun";

const REQUEST: AgentRunRequest = {
  task_id: "chat.workspace",
  input: {
    messages: [
      {
        id: "m-1",
        role: "user",
        parts: [{ type: "text", text: "Show project status" }],
      },
    ],
  },
};

function event(seq: number, input: Record<string, unknown>): AgentRunEvent {
  return {
    event_id: `run-1:${seq}`,
    run_id: "run-1",
    task_id: "chat.workspace",
    seq,
    created_at: `2026-06-04T00:00:0${seq}.000Z`,
    metadata: {},
    ...input,
  } as AgentRunEvent;
}

function sseFrame(agentEvent: AgentRunEvent): string {
  return `event: ${agentEvent.type}\ndata: ${JSON.stringify(agentEvent)}\n\n`;
}

function responseFor(events: AgentRunEvent[]): Response {
  return new Response(events.map(sseFrame).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("useAgentRun", () => {
  it("starts a run and exposes shared completed state", async () => {
    const fetch = vi.fn().mockResolvedValue(
      responseFor([
        event(0, { type: "run.started", run_status: "running", input: {} }),
        event(1, { type: "model.delta", delta: "Done", channel: "text" }),
        event(2, {
          type: "run.completed",
          run_status: "completed",
          artifact_ids: [],
          usage: {},
        }),
      ]),
    );

    const { result } = renderHook(() => useAgentRun({ fetch }));

    await act(async () => {
      await result.current.start(REQUEST);
    });

    expect(result.current.state.phase).toBe("completed");
    expect(result.current.state.text).toBe("Done");
    expect(result.current.canCancel).toBe(false);
    expect(result.current.canRetry).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries the last request after a runtime error event", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        responseFor([
          event(0, { type: "run.started", run_status: "running", input: {} }),
          event(1, {
            type: "run.error",
            run_status: "error",
            error: {
              code: "model_failed",
              message: "Model failed.",
              recoverable: true,
              details: {},
            },
          }),
        ]),
      )
      .mockResolvedValueOnce(
        responseFor([
          event(0, { type: "run.started", run_status: "running", input: {} }),
          event(1, {
            type: "run.completed",
            run_status: "completed",
            artifact_ids: [],
            usage: {},
          }),
        ]),
      );

    const { result } = renderHook(() => useAgentRun({ fetch }));

    await act(async () => {
      await result.current.start(REQUEST);
    });
    expect(result.current.state.error?.kind).toBe("runtime");
    expect(result.current.canRetry).toBe(true);

    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.state.phase).toBe("completed");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("aborts the active request when cancelled", async () => {
    const captured: { signal: AbortSignal | null } = { signal: null };
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        captured.signal = init?.signal ?? null;
        return new Promise<Response>((_resolve, reject) => {
          captured.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      },
    );

    const { result } = renderHook(() => useAgentRun({ fetch }));
    const started = result.current.start(REQUEST).catch(() => null);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.cancel("Stopped by user.");
    });
    await started;

    expect(captured.signal?.aborted).toBe(true);
    expect(result.current.state.phase).toBe("cancelled");
    expect(result.current.state.error?.kind).toBe("cancelled");
  });

  it("ignores stale aborts from a previous run after a new run starts", async () => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          const signal = init?.signal;
          return new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              setTimeout(
                () => reject(new DOMException("Aborted", "AbortError")),
                0,
              );
            });
          });
        },
      )
      .mockResolvedValueOnce(
        responseFor([
          event(0, { type: "run.started", run_status: "running", input: {} }),
          event(1, {
            type: "run.completed",
            run_status: "completed",
            artifact_ids: [],
            usage: {},
          }),
        ]),
      );

    const { result } = renderHook(() => useAgentRun({ fetch }));
    let firstRun: Promise<unknown> = Promise.resolve();
    act(() => {
      firstRun = result.current.start(REQUEST).catch(() => null);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.start(REQUEST);
    });
    await firstRun;

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.state.phase).toBe("completed");
    expect(result.current.state.error).toBeNull();
  });
});
