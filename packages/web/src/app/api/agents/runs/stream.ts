import { logger } from "@/lib/logging/logger";
import { AgentArtifactSchema, AgentRunEventSchema } from "@reef/core";
import type { AgentRunEvent } from "@reef/core";

const EVENT_STREAM_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export function createTopLevelRunEmitter(
  taskId: string,
  writeEvent: (event: AgentRunEvent) => void,
) {
  const runId = `${taskId}:${Date.now().toString(36)}`;
  let seq = 0;
  let terminalEmitted = false;
  const artifactIds: string[] = [];

  const baseEvent = () => ({
    event_id: `${runId}:${seq}`,
    run_id: runId,
    task_id: taskId,
    seq: seq++,
    created_at: new Date().toISOString(),
    metadata: { route: "POST /api/agents/runs" },
  });

  const emitTerminal = (event: Record<string, unknown>) => {
    if (terminalEmitted) return;
    terminalEmitted = true;
    writeEvent(AgentRunEventSchema.parse({ ...baseEvent(), ...event }));
  };

  const rewriteChildEvent = (event: AgentRunEvent): AgentRunEvent | null => {
    if (
      terminalEmitted ||
      event.type === "run.started" ||
      isTerminalRunEvent(event)
    ) {
      return null;
    }

    const nextBase = baseEvent();
    const metadata = {
      ...event.metadata,
      ...nextBase.metadata,
      nested_run_id: event.run_id,
      nested_task_id: event.task_id,
    };

    if (event.type === "artifact.final") {
      const artifact = AgentArtifactSchema.parse({
        ...event.artifact,
        run_id: runId,
        task_id: taskId,
        metadata: {
          ...event.artifact.metadata,
          nested_run_id: event.artifact.run_id,
          nested_task_id: event.artifact.task_id,
        },
      });
      if (!artifactIds.includes(artifact.artifact_id)) {
        artifactIds.push(artifact.artifact_id);
      }
      return AgentRunEventSchema.parse({
        ...event,
        ...nextBase,
        created_at: event.created_at,
        metadata,
        artifact,
      });
    }

    return AgentRunEventSchema.parse({
      ...event,
      ...nextBase,
      created_at: event.created_at,
      metadata,
    });
  };

  return {
    started: (input: Record<string, unknown>) =>
      writeEvent(
        AgentRunEventSchema.parse({
          ...baseEvent(),
          type: "run.started",
          run_status: "running",
          input,
        }),
      ),
    completed: (usage: Record<string, unknown>) =>
      emitTerminal({
        type: "run.completed",
        run_status: "completed",
        artifact_ids: [...artifactIds],
        usage,
      }),
    empty: (reason: string) =>
      emitTerminal({
        type: "run.empty",
        run_status: "empty",
        reason,
      }),
    cancelled: (reason: string) =>
      emitTerminal({
        type: "run.cancelled",
        run_status: "cancelled",
        reason,
      }),
    error: (error: unknown) =>
      emitTerminal({
        type: "run.error",
        run_status: "error",
        error: {
          code: "activity_scan_failed",
          message:
            error instanceof Error
              ? error.message
              : "Activity scan agent run failed.",
          recoverable: false,
          details: {},
        },
      }),
    childEvent: (event: AgentRunEvent) => {
      const rewritten = rewriteChildEvent(event);
      if (rewritten) writeEvent(rewritten);
    },
  };
}

/**
 * Handlers the UI-message-stream parser calls for each part it recognizes.
 * The bridge maps these to agent-run SSE events; the parser stays a pure
 * tokenizer over the AI-SDK UI-message stream.
 */
interface UiMessageStreamHandlers {
  onTextDelta: (delta: string) => void;
  onToolInput: (part: {
    toolCallId: string;
    toolName: string;
    input: unknown;
  }) => void;
  onToolOutput: (part: { toolCallId: string; output: unknown }) => void;
  onToolError: (part: { toolCallId: string; errorText: string }) => void;
}

export function createChatRunEventBridge(
  writeEvent: (event: AgentRunEvent) => void,
) {
  let runId: string | null = null;
  let taskId = "chat.workspace";
  let seq = 0;
  let terminalEvent: AgentRunEvent | null = null;
  // Tool names arrive on `tool-input-available`; `tool-output-available` and
  // `tool-output-error` carry only the call id, so remember the name here to
  // pair the completion/error frame with its tool.
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

  const emitModelDelta = (delta: string) => {
    if (!delta) return;
    emitBridgeEvent({ type: "model.delta", delta, channel: "text" });
  };

  // Tool inputs/outputs are surfaced to the PM as transparency steps
  // (REEF-361 AC2). The agent-run tool payloads are `Metadata` records, so wrap
  // any non-object value rather than letting schema validation reject the frame.
  const asMetadata = (value: unknown): Record<string, unknown> =>
    isRecord(value) ? value : value === undefined ? {} : { value };

  const uiMessageParser = createUiMessageStreamParser({
    onTextDelta: emitModelDelta,
    onToolInput: ({ toolCallId, toolName, input }) => {
      toolNames.set(toolCallId, toolName);
      emitBridgeEvent({
        type: "tool.called",
        tool: { tool_call_id: toolCallId, tool_name: toolName },
        input: asMetadata(input),
      });
    },
    onToolOutput: ({ toolCallId, output }) => {
      emitBridgeEvent({
        type: "tool.completed",
        tool: {
          tool_call_id: toolCallId,
          tool_name: toolNames.get(toolCallId) ?? "tool",
        },
        output: asMetadata(output),
      });
    },
    onToolError: ({ toolCallId, errorText }) => {
      emitBridgeEvent({
        type: "tool.error",
        tool: {
          tool_call_id: toolCallId,
          tool_name: toolNames.get(toolCallId) ?? "tool",
        },
        error: {
          code: "chat_tool_error",
          message: errorText || "Tool call failed.",
          recoverable: false,
          details: {},
        },
      });
    },
  });

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
    onUiMessageChunk: uiMessageParser.push,
    flushTerminal: () => {
      uiMessageParser.flush();
      if (!terminalEvent) return;
      writeEvent(rewriteEvent(terminalEvent));
      terminalEvent = null;
    },
  };
}

function createUiMessageStreamParser(handlers: UiMessageStreamHandlers) {
  let buffer = "";

  const processBufferedFrames = () => {
    buffer = buffer.replace(/\r\n/g, "\n");
    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex >= 0) {
      const frame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      processUiMessageFrame(frame, handlers);
      separatorIndex = buffer.indexOf("\n\n");
    }
  };

  return {
    push: (chunk: string) => {
      buffer += chunk;
      processBufferedFrames();
    },
    flush: () => {
      processBufferedFrames();
      if (buffer.trim()) processUiMessageFrame(buffer, handlers);
      buffer = "";
    },
  };
}

function processUiMessageFrame(
  frame: string,
  handlers: UiMessageStreamHandlers,
) {
  for (const line of frame.split("\n")) {
    if (!line.startsWith("data:")) continue;
    handleUiMessagePart(line.slice("data:".length).trimStart(), handlers);
  }
}

function handleUiMessagePart(
  payload: string,
  handlers: UiMessageStreamHandlers,
) {
  const trimmedPayload = payload.trim();
  if (!trimmedPayload || trimmedPayload === "[DONE]") return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmedPayload);
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;

  switch (parsed.type) {
    case "text-delta":
      if (typeof parsed.delta === "string") handlers.onTextDelta(parsed.delta);
      return;
    case "tool-input-available":
      if (
        typeof parsed.toolCallId === "string" &&
        typeof parsed.toolName === "string"
      ) {
        handlers.onToolInput({
          toolCallId: parsed.toolCallId,
          toolName: parsed.toolName,
          input: parsed.input,
        });
      }
      return;
    case "tool-output-available":
      if (typeof parsed.toolCallId === "string") {
        handlers.onToolOutput({
          toolCallId: parsed.toolCallId,
          output: parsed.output,
        });
      }
      return;
    case "tool-output-error":
      if (typeof parsed.toolCallId === "string") {
        handlers.onToolError({
          toolCallId: parsed.toolCallId,
          errorText:
            typeof parsed.errorText === "string" ? parsed.errorText : "",
        });
      }
      return;
    default:
      return;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export async function drainResponseBody(
  response: Response,
  onChunk?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }
      if (done) {
        const trailing = decoder.decode();
        if (trailing) onChunk?.(trailing);
        return;
      }
      if (value) onChunk?.(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
}
