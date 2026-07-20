// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  POST,
  activityRunBody,
  chatRunBody,
  childArtifactFinal,
  cleanupAgentRunsRouteMocks,
  enrichmentRunBody,
  makeRequest,
  mockCreateWorkspaceChatAgentResponse,
  mockEnrichIssue,
  mockGetAkbAdapter,
  mockScanAndPersistActivitySuggestions,
  parseSseEvents,
  resetAgentRunsRouteMocks,
  runCompleted,
  runError,
  runStarted,
} from "./route.testSupport";

describe("POST /api/agents/runs validation", () => {
  beforeEach(() => {
    resetAgentRunsRouteMocks();
  });

  afterEach(() => {
    cleanupAgentRunsRouteMocks();
  });

  it("returns typed runtime errors for invalid run requests", async () => {
    const res = await POST(makeRequest({ task_id: "unknown.task", input: {} }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "Agent run request is missing or invalid.",
      runtime_error: { code: "invalid_agent_run_request" },
    });
  });

  it("rejects malformed activity scan vault ids before AKB calls", async () => {
    const res = await POST(
      makeRequest({
        ...activityRunBody,
        input: { ...activityRunBody.input, vault: "../reef-test" },
      }),
    );

    expect(res.status).toBe(400);
    expect(mockScanAndPersistActivitySuggestions).not.toHaveBeenCalled();
  });

  it("rejects malformed issue enrichment vault ids before enrichment calls", async () => {
    const res = await POST(
      makeRequest({
        ...enrichmentRunBody,
        input: { ...enrichmentRunBody.input, vault: "reef/test" },
      }),
    );

    expect(res.status).toBe(400);
    expect(mockEnrichIssue).not.toHaveBeenCalled();
  });

  it("rejects chat messages without ids before creating a stream", async () => {
    const res = await POST(
      makeRequest({
        task_id: "chat.workspace",
        input: {
          messages: [
            {
              role: "user",
              parts: [{ type: "text", text: "Show project status" }],
            },
          ],
        },
      }),
    );

    expect(res.status).toBe(400);
    expect(mockCreateWorkspaceChatAgentResponse).not.toHaveBeenCalled();
  });

  it("preserves session-clearing headers before creating an agent stream", async () => {
    const authHeaders = new Headers({ "Cache-Control": "no-store" });
    authHeaders.append("Set-Cookie", "__reef_session=; Path=/; Max-Age=0");
    authHeaders.append("Set-Cookie", "__reef_sso=; Path=/; Max-Age=0");
    mockGetAkbAdapter.mockReturnValueOnce({
      response: Promise.resolve(
        Response.json(
          { error: "Your session has expired." },
          {
            status: 401,
            headers: authHeaders,
          },
        ),
      ),
    });

    const res = await POST(makeRequest(chatRunBody));

    expect(res.status).toBe(401);
    expect((await res.json()).runtime_error?.code).toBe(
      "workspace_auth_required",
    );
    expect(res.headers.get("set-cookie")).toContain("__reef_session=");
    expect(res.headers.get("set-cookie")).toContain("__reef_sso=");
    expect(res.headers.getSetCookie()).toHaveLength(2);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mockCreateWorkspaceChatAgentResponse).not.toHaveBeenCalled();
  });
});
