import { logger } from "@/lib/logging/logger";
import { AgentRunEventSchema } from "@reef/core";
import type { AgentRunEvent } from "@reef/core";
import {
  parseJsonEventStream,
  type UIMessageChunk,
  uiMessageChunkSchema,
} from "ai";

const EVENT_STREAM_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export function createChatRunEventBridge(
  writeEvent: (event: AgentRunEvent) => void,
) {
  let runId: string | null = null;
  let taskId = "chat.workspace";
  let seq = 0;
  let terminalEvent: AgentRunEvent | null = null;
  // Tool output chunks carry the call id. The v7 input chunks establish
  // the name before the output is emitted, so retain that pairing here.
  const toolNames = new Map<string, string>();

  const rewriteEvent = (event: AgentRunEvent): AgentRunEvent =>
    AgentRunEventSchema.parse({
      ...event,
      event_id: `${event.run_id}:${seq}`,
      seq: seq++,
    });

  const emitBridgeEvent = (event: Record<string, unknown>) => {
    if (!runId) return;
    writeEvent(
      AgentRunEventSchema.parse({
        event_id: `${runId}:${seq}`,
        run_id: runId,
        task_id: taskId,
        seq: seq++,
        created_at: new Date().toISOString(),
        metadata: { source_format: "ai-sdk-ui-message-stream" },
        ...event,
      }),
    );
  };

  // Tool inputs/outputs are surfaced to the PM as transparency steps
  // (REEF-361 AC2). The agent-run tool payloads are `Metadata` records, so wrap
  // any non-object value rather than letting schema validation reject the frame.
  const asMetadata = (value: unknown): Record<string, unknown> =>
    isRecord(value) ? value : value === undefined ? {} : { value };

  const emitToolError = (
    toolCallId: string,
    errorText: string,
    code = "chat_tool_error",
  ) => {
    const toolName = toolNameFor(toolCallId);
    emitBridgeEvent({
      type: "tool.error",
      tool: { tool_call_id: toolCallId, tool_name: toolName },
      error: {
        code,
        message: errorText || "Tool call failed.",
        recoverable: false,
        details: {},
      },
    });
  };

  const toolNameFor = (toolCallId: string): string => {
    const toolName = toolNames.get(toolCallId);
    if (!toolName) {
      throw new Error("AI SDK tool output had no matching input part.");
    }
    return toolName;
  };

  const handleUiMessageChunk = (chunk: UIMessageChunk) => {
    switch (chunk.type) {
      case "text-delta":
        if (chunk.delta) {
          emitBridgeEvent({
            type: "model.delta",
            delta: chunk.delta,
            channel: "text",
          });
        }
        return;
      case "tool-input-start":
        toolNames.set(chunk.toolCallId, chunk.toolName);
        return;
      case "tool-input-available":
        toolNames.set(chunk.toolCallId, chunk.toolName);
        emitBridgeEvent({
          type: "tool.called",
          tool: {
            tool_call_id: chunk.toolCallId,
            tool_name: chunk.toolName,
          },
          input: asMetadata(chunk.input),
        });
        return;
      case "tool-input-error":
        toolNames.set(chunk.toolCallId, chunk.toolName);
        emitBridgeEvent({
          type: "tool.called",
          tool: {
            tool_call_id: chunk.toolCallId,
            tool_name: chunk.toolName,
          },
          input: asMetadata(chunk.input),
        });
        emitToolError(chunk.toolCallId, chunk.errorText);
        return;
      case "tool-output-available":
        // Preliminary output is an intermediate update in the v7 contract,
        // not the final result of the tool execution.
        if (chunk.preliminary) return;
        emitBridgeEvent({
          type: "tool.completed",
          tool: {
            tool_call_id: chunk.toolCallId,
            tool_name: toolNameFor(chunk.toolCallId),
          },
          output: asMetadata(chunk.output),
        });
        return;
      case "tool-output-error":
        emitToolError(chunk.toolCallId, chunk.errorText);
        return;
      case "tool-output-denied":
        emitToolError(
          chunk.toolCallId,
          "Tool call was denied.",
          "chat_tool_denied",
        );
        return;
      default:
        return;
    }
  };

  return {
    onLifecycleEvent: (event: AgentRunEvent) => {
      runId = event.run_id;
      taskId = event.task_id;
      if (isTerminalRunEvent(event)) {
        terminalEvent = event;
        return;
      }
      writeEvent(rewriteEvent(event));
    },
    onUiMessageChunk: handleUiMessageChunk,
    flushTerminal: () => {
      if (!terminalEvent) return;
      writeEvent(rewriteEvent(terminalEvent));
      terminalEvent = null;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function drainUiMessageStream(
  response: Response,
  onChunk: (chunk: UIMessageChunk) => void,
  signal?: AbortSignal,
): Promise<void> {
  const body = response.body;
  if (!body) return;

  const parsedStream = parseJsonEventStream({
    stream: body,
    schema: uiMessageChunkSchema,
  });
  const reader = parsedStream.getReader();

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (done) return;
      if (!value.success) throw value.error;
      onChunk(value.value);
    }
  } finally {
    reader.releaseLock();
  }
}

export function createAgentEventStream(
  taskId: string,
  signal: AbortSignal,
  execute: (
    writeEvent: (event: AgentRunEvent) => void,
    signal: AbortSignal,
  ) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let terminalWritten = false;
      let aborted = signal.aborted;
      const onAbort = () => {
        aborted = true;
      };
      signal.addEventListener("abort", onAbort, { once: true });
      const writeEvent = (event: AgentRunEvent) => {
        if (aborted) return;
        if (isTerminalRunEvent(event)) terminalWritten = true;
        controller.enqueue(encoder.encode(encodeAgentEvent(event)));
      };

      execute(writeEvent, signal)
        .catch((err) => {
          if (aborted || signal.aborted) return;
          if (terminalWritten) return;
          const message =
            err instanceof Error ? err.message : "Agent run failed.";
          logger.error({ err, task_id: taskId }, "agent_run_stream_failed");
          writeEvent(createRouteErrorEvent(taskId, message));
        })
        .finally(() => {
          signal.removeEventListener("abort", onAbort);
          controller.close();
        });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: EVENT_STREAM_HEADERS,
  });
}

function isTerminalRunEvent(event: AgentRunEvent): boolean {
  return (
    event.type === "run.completed" ||
    event.type === "run.empty" ||
    event.type === "run.cancelled" ||
    event.type === "run.error"
  );
}

function encodeAgentEvent(event: AgentRunEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function createRouteErrorEvent(taskId: string, message: string): AgentRunEvent {
  return AgentRunEventSchema.parse({
    event_id: `${taskId}:route-error`,
    run_id: `${taskId}:route-error`,
    task_id: taskId,
    seq: 0,
    created_at: new Date().toISOString(),
    type: "run.error",
    run_status: "error",
    error: {
      code: "agent_run_failed",
      message,
      recoverable: false,
      details: {},
    },
    metadata: { route: "POST /api/agents/runs" },
  });
}
