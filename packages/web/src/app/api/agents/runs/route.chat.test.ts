// @vitest-environment node
import type { AgentRunEvent } from "@reef/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  POST,
  chatRunBody,
  cleanupAgentRunsRouteMocks,
  enrichmentRunBody,
  makeRequest,
  message,
  mockCreateGitHubAdapter,
  mockCreateWorkspaceChatAgentResponse,
  mockEnrichIssue,
  parseSseEvents,
  resetAgentRunsRouteMocks,
  runError,
  runStarted,
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

  it("streams chat.workspace without GitHub adapter when Authorization is missing", async () => {
    const res = await POST(makeRequest(chatRunBody, { Authorization: null }));

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

  it("streams chat.workspace AKB-only for malformed GitHub Authorization", async () => {
    // A malformed PAT degrades to AKB-only grounding rather than 401 — a stale
    // browser token must not block the agent run (REEF-243).
    const res = await POST(
      makeRequest(chatRunBody, { Authorization: "Token ghp_test" }),
    );

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
