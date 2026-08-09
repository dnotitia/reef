// @vitest-environment node

import type { AgentRunEvent } from "@reef/core";
import { describe, expect, it } from "vitest";
import { createChatRunEventBridge, drainUiMessageStream } from "./stream";

function lifecycleEvent(type: "run.started" | "run.completed"): AgentRunEvent {
  return type === "run.started"
    ? {
        event_id: "chat.workspace:started",
        run_id: "chat.workspace:run",
        task_id: "chat.workspace",
        seq: 0,
        created_at: "2026-08-09T00:00:00.000Z",
        type,
        run_status: "running",
        input: {},
        metadata: {},
      }
    : {
        event_id: "chat.workspace:completed",
        run_id: "chat.workspace:run",
        task_id: "chat.workspace",
        seq: 1,
        created_at: "2026-08-09T00:00:01.000Z",
        type,
        run_status: "completed",
        artifact_ids: [],
        usage: {},
        metadata: {},
      };
}

function uiMessageResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}

describe("chat UI message stream bridge", () => {
  it("maps official v7 tool parts and preserves preliminary output semantics", async () => {
    const events: AgentRunEvent[] = [];
    const bridge = createChatRunEventBridge((event) => events.push(event));
    bridge.onLifecycleEvent(lifecycleEvent("run.started"));

    await drainUiMessageStream(
      uiMessageResponse([
        'data: {"type":"tool-input-start","toolCallId":"call-1","toolName":"search_issues"}\n\n',
        'data: {"type":"tool-input-available","toolCallId":"call-1","toolName":"search_issues","input":{"query":"login"}}\n\n',
        'data: {"type":"tool-output-available","toolCallId":"call-1","output":{"issues":[]},"preliminary":true}\n\n',
        'data: {"type":"tool-output-available","toolCallId":"call-1","output":{"issues":[{"id":"REEF-001"}]}}\n\n',
        'data: {"type":"text-delta","id":"text-1","delta":"Found REEF-001."}\n\n',
        "data: [DONE]\n\n",
      ]),
      bridge.onUiMessageChunk,
    );
    bridge.onLifecycleEvent(lifecycleEvent("run.completed"));
    bridge.flushTerminal();

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.called",
      "tool.completed",
      "model.delta",
      "run.completed",
    ]);
    expect(events[1]).toMatchObject({
      type: "tool.called",
      tool: { tool_call_id: "call-1", tool_name: "search_issues" },
      input: { query: "login" },
    });
    expect(events[2]).toMatchObject({
      type: "tool.completed",
      output: { issues: [{ id: "REEF-001" }] },
    });
  });

  it("maps v7 input and output errors to an explicit tool error", async () => {
    const events: AgentRunEvent[] = [];
    const bridge = createChatRunEventBridge((event) => events.push(event));
    bridge.onLifecycleEvent(lifecycleEvent("run.started"));

    await drainUiMessageStream(
      uiMessageResponse([
        'data: {"type":"tool-input-error","toolCallId":"call-2","toolName":"read_issue","input":{"id":"REEF-404"},"errorText":"Invalid issue id"}\n\n',
        'data: {"type":"tool-input-start","toolCallId":"call-3","toolName":"search_issues"}\n\n',
        'data: {"type":"tool-output-error","toolCallId":"call-3","errorText":"Upstream unavailable"}\n\n',
        "data: [DONE]\n\n",
      ]),
      bridge.onUiMessageChunk,
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.called",
      "tool.error",
      "tool.error",
    ]);
    expect(events[2]).toMatchObject({
      type: "tool.error",
      tool: { tool_call_id: "call-2", tool_name: "read_issue" },
      error: { message: "Invalid issue id" },
    });
    expect(events[3]).toMatchObject({
      type: "tool.error",
      tool: { tool_call_id: "call-3", tool_name: "search_issues" },
      error: { message: "Upstream unavailable" },
    });
  });
});
