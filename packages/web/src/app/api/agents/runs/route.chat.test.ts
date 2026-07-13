// @vitest-environment node
import type { AgentRunEvent } from "@reef/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOT_CONFIGURED,
  POST,
  chatRunBody,
  cleanupAgentRunsRouteMocks,
  enrichmentRunBody,
  makeRequest,
  makeUiMessageStreamResponse,
  message,
  mockCreateGitHubAdapter,
  mockCreateLlmAdapter,
  mockCreateWorkspaceChatAgentResponse,
  mockEnrichIssue,
  mockGetAkbCurrentActor,
  parseSseEvents,
  resetAgentRunsRouteMocks,
  runCompleted,
  runError,
  runStarted,
  setServerAppConfig,
} from "./route.testSupport";

describe("POST /api/agents/runs chat streaming", () => {
  beforeEach(() => {
    resetAgentRunsRouteMocks();
  });

  afterEach(() => {
    cleanupAgentRunsRouteMocks();
  });

  it("streams chat.workspace AgentRunEvent frames", async () => {
    const res = await POST(makeRequest(chatRunBody));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSseEvents(await res.text());
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "model.delta",
      "run.completed",
    ]);
    const [delta] = events.filter((event) => event.type === "model.delta");
    expect(delta?.delta).toBe("Hello world");
    expect(delta?.delta).not.toContain("data:");
    expect(mockCreateWorkspaceChatAgentResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-test",
        messages: [message],
      }),
    );
  });

  it("sets the SSE no-buffering streaming headers (REEF-361 AC5)", async () => {
    const res = await POST(makeRequest(chatRunBody));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // The reverse-proxy contract that keeps chat streaming: nginx/K8s should not
    // buffer the response.
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
  });

  it("bridges tool calls into tool.called/tool.completed frames (REEF-361 AC2)", async () => {
    mockCreateWorkspaceChatAgentResponse.mockImplementationOnce(
      async (params: { onEvent?: (event: AgentRunEvent) => void }) => {
        params.onEvent?.(runStarted("chat.workspace"));
        params.onEvent?.(runCompleted("chat.workspace"));
        return makeUiMessageStreamResponse([
          'data: {"type":"tool-input-available","toolCallId":"call-1","toolName":"search_issues","input":{"query":"login"}}\n\n',
          'data: {"type":"tool-output-available","toolCallId":"call-1","output":{"issues":[{"id":"REEF-1"},{"id":"REEF-2"}]}}\n\n',
          'data: {"type":"text-delta","id":"t","delta":"Found 2 issues."}\n\n',
          "data: [DONE]\n\n",
        ]);
      },
    );

    const res = await POST(makeRequest(chatRunBody));
    const events = parseSseEvents(await res.text());

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.called",
      "tool.completed",
      "model.delta",
      "run.completed",
    ]);

    const called = events.find((event) => event.type === "tool.called");
    const completed = events.find((event) => event.type === "tool.completed");
    if (
      called?.type !== "tool.called" ||
      completed?.type !== "tool.completed"
    ) {
      throw new Error("expected tool frames");
    }
    expect(called.tool).toEqual({
      tool_call_id: "call-1",
      tool_name: "search_issues",
    });
    expect(called.input).toEqual({ query: "login" });
    // tool-output-available carries no name; the bridge pairs it from the call.
    expect(completed.tool.tool_name).toBe("search_issues");
    expect(completed.output).toEqual({
      issues: [{ id: "REEF-1" }, { id: "REEF-2" }],
    });
  });

  it("bridges a tool failure into a tool.error frame (REEF-361 AC2)", async () => {
    mockCreateWorkspaceChatAgentResponse.mockImplementationOnce(
      async (params: { onEvent?: (event: AgentRunEvent) => void }) => {
        params.onEvent?.(runStarted("chat.workspace"));
        params.onEvent?.(runCompleted("chat.workspace"));
        return makeUiMessageStreamResponse([
          'data: {"type":"tool-input-available","toolCallId":"call-9","toolName":"read_issue","input":{"id":"REEF-404"}}\n\n',
          'data: {"type":"tool-output-error","toolCallId":"call-9","errorText":"Issue not found"}\n\n',
          "data: [DONE]\n\n",
        ]);
      },
    );

    const res = await POST(makeRequest(chatRunBody));
    const events = parseSseEvents(await res.text());
    const errored = events.find((event) => event.type === "tool.error");
    if (errored?.type !== "tool.error") throw new Error("expected tool.error");
    expect(errored.tool.tool_name).toBe("read_issue");
    expect(errored.error.message).toBe("Issue not found");
  });

  it("streams chat.workspace AKB-only when the GitHub App is not configured", async () => {
    setServerAppConfig(NOT_CONFIGURED);
    const res = await POST(makeRequest(chatRunBody));

    expect(res.status).toBe(200);
    expect(parseSseEvents(await res.text()).map((event) => event.type)).toEqual(
      ["run.started", "model.delta", "run.completed"],
    );
    expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    expect(mockCreateWorkspaceChatAgentResponse).toHaveBeenCalledWith(
      expect.not.objectContaining({
        githubAdapter: expect.anything(),
      }),
    );
  });

  it("rejects chat before the LLM when AKB session verification fails", async () => {
    mockGetAkbCurrentActor.mockResolvedValueOnce({
      response: Response.json(
        { error: "This account is suspended." },
        {
          status: 403,
          headers: {
            "Set-Cookie": "__reef_session=; Path=/; Max-Age=0",
            "Cache-Control": "no-store",
          },
        },
      ),
    });

    const res = await POST(makeRequest(chatRunBody));

    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toContain("__reef_session=");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mockCreateLlmAdapter).not.toHaveBeenCalled();
    expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    expect(mockCreateWorkspaceChatAgentResponse).not.toHaveBeenCalled();
  });

  it("does not emit a duplicate route error after a task terminal error", async () => {
    mockEnrichIssue.mockImplementationOnce(
      async (params: {
        onEvent?: (event: AgentRunEvent) => Promise<void> | void;
      }) => {
        await params.onEvent?.(runStarted("issue.enrichment"));
        await params.onEvent?.(runError("issue.enrichment"));
        throw new Error("already streamed");
      },
    );

    const res = await POST(makeRequest(enrichmentRunBody));
    const events = parseSseEvents(await res.text());

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.error",
    ]);
    expect(events.filter((event) => event.type === "run.error")).toHaveLength(
      1,
    );
  });

  it("flushes chat.workspace terminal errors emitted before response streaming fails", async () => {
    mockCreateWorkspaceChatAgentResponse.mockImplementationOnce(
      async (params: {
        onEvent?: (event: AgentRunEvent) => Promise<void> | void;
      }) => {
        await params.onEvent?.(runStarted("chat.workspace"));
        await params.onEvent?.(runError("chat.workspace"));
        throw new Error("failed before body");
      },
    );

    const res = await POST(makeRequest(chatRunBody));
    const events = parseSseEvents(await res.text());

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.error",
    ]);
    expect(events.map((event) => event.run_id)).toEqual([
      "chat.workspace:run",
      "chat.workspace:run",
    ]);
    expect(
      events.filter((event) => event.run_id.endsWith(":route-error")),
    ).toHaveLength(0);
  });
});
