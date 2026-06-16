// @vitest-environment node

import type { AgentRunEvent, AgentRunRequest } from "@reef/core";
import { describe, expect, it, vi } from "vitest";
import {
  AgentRunClientError,
  readAgentRunEvents,
  streamAgentRun,
} from "./streamClient";

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

function sseFrame(event: AgentRunEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function makeEvent(seq: number, input: Record<string, unknown>): AgentRunEvent {
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

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    {
      status,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

describe("agent run stream client", () => {
  it("parses split SSE AgentRunEvent frames", async () => {
    const started = makeEvent(0, {
      type: "run.started",
      run_status: "running",
      input: {},
    });
    const completed = makeEvent(1, {
      type: "run.completed",
      run_status: "completed",
      artifact_ids: [],
      usage: {},
    });
    const payload = `${sseFrame(started)}${sseFrame(completed)}`;
    const events: AgentRunEvent[] = [];

    for await (const event of readAgentRunEvents(
      streamResponse([payload.slice(0, 42), payload.slice(42)]),
    )) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.completed",
    ]);
  });

  it("updates common run state while streaming", async () => {
    const fetch = vi.fn().mockResolvedValue(
      streamResponse([
        sseFrame(
          makeEvent(0, {
            type: "run.started",
            run_status: "running",
            input: {},
          }),
        ),
        sseFrame(
          makeEvent(1, {
            type: "model.delta",
            delta: "Done",
            channel: "text",
          }),
        ),
        sseFrame(
          makeEvent(2, {
            type: "run.completed",
            run_status: "completed",
            artifact_ids: [],
            usage: {},
          }),
        ),
      ]),
    );

    const seen: string[] = [];
    const state = await streamAgentRun(REQUEST, {
      fetch,
      onEvent: (event) => seen.push(event.type),
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/agents/runs",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual(
      REQUEST,
    );
    expect(seen).toEqual(["run.started", "model.delta", "run.completed"]);
    expect(state.phase).toBe("completed");
    expect(state.text).toBe("Done");
  });

  it("throws a stream parsing error for malformed event JSON", async () => {
    await expect(
      collectEvents(
        readAgentRunEvents(
          streamResponse(['event: run.started\ndata: {"bad"\n\n']),
        ),
      ),
    ).rejects.toMatchObject({
      failure: { kind: "stream", code: "agent_run_stream_parse_error" },
    });
  });

  it("throws a stream error when EOF arrives before a terminal event", async () => {
    const fetch = vi.fn().mockResolvedValue(
      streamResponse([
        sseFrame(
          makeEvent(0, {
            type: "run.started",
            run_status: "running",
            input: {},
          }),
        ),
        sseFrame(
          makeEvent(1, {
            type: "model.delta",
            delta: "Still working",
            channel: "text",
          }),
        ),
      ]),
    );

    await expect(streamAgentRun(REQUEST, { fetch })).rejects.toMatchObject({
      failure: {
        kind: "stream",
        code: "agent_run_stream_parse_error",
        message: "Agent run stream ended before a terminal event.",
        details: {
          phase: "running",
          run_id: "run-1",
          task_id: "chat.workspace",
          seq: 1,
        },
      },
    });
  });

  it("throws an HTTP error before stream parsing", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Workspace session is missing.",
          runtime_error: {
            code: "workspace_auth_required",
            message: "Workspace session is missing.",
            recoverable: false,
            details: {},
          },
        }),
        { status: 401 },
      ),
    );

    let caught: unknown;
    try {
      await streamAgentRun(REQUEST, { fetch });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AgentRunClientError);
    expect((caught as AgentRunClientError).failure).toMatchObject({
      kind: "http",
      status: 401,
      code: "workspace_auth_required",
    });
  });
});

async function collectEvents(
  stream: AsyncGenerator<AgentRunEvent>,
): Promise<AgentRunEvent[]> {
  const events: AgentRunEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
