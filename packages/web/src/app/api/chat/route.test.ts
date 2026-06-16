// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/telemetry", () => ({
  tracer: {
    startSpan: vi.fn(() => ({
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
    })),
  },
}));

vi.mock("@/lib/metrics", () => ({
  agentLoopStepsTotal: { inc: vi.fn() },
  toolCallsTotal: { inc: vi.fn() },
}));

const {
  mockCreateWorkspaceChatAgentResponse,
  mockCreateGitHubAdapter,
  mockCreateLlmAdapter,
  mockCreateAkbAdapter,
  mockGetWorkspaceChatTaskConfig,
} = vi.hoisted(() => ({
  mockCreateWorkspaceChatAgentResponse: vi.fn(),
  mockCreateGitHubAdapter: vi.fn(),
  mockCreateLlmAdapter: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
  mockGetWorkspaceChatTaskConfig: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    createWorkspaceChatAgentResponse: mockCreateWorkspaceChatAgentResponse,
    createGitHubAdapter: mockCreateGitHubAdapter,
    createLlmAdapter: mockCreateLlmAdapter,
    createAkbAdapter: mockCreateAkbAdapter,
    getWorkspaceChatTaskConfig: mockGetWorkspaceChatTaskConfig,
  };
});

import { VAULT_HEADER } from "@/lib/akb/headers";
import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT, makeJwt } from "../__test-helpers__/jwt";
import { POST } from "./route";

const VALID_BODY = {
  messages: [
    {
      id: "m-1",
      role: "user" as const,
      parts: [{ type: "text", text: "hello" }],
    },
  ],
};

function makeRequest(
  options: {
    auth?: string | null;
    vault?: string | null;
    cookie?: string | null;
    body?: unknown;
  } = {},
): Request {
  const headers: Record<string, string> = {};
  if (options.auth !== null)
    headers.authorization = options.auth ?? "Bearer ghp_token";
  if (options.vault !== null)
    headers[VAULT_HEADER.toLowerCase()] = options.vault ?? "reef-acme";
  if (options.cookie !== null)
    headers.cookie = options.cookie ?? `${SESSION_COOKIE}=${VALID_JWT}`;
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? VALID_BODY),
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
    vi.stubEnv("OPENROUTER_BASE_URL", "https://api.example.com");
    vi.stubEnv("REEF_LLM_MODEL", "gpt-4o-mini");
    mockCreateLlmAdapter.mockReturnValue({
      model: () => ({ id: "gpt-4o-mini" }),
    });
    mockCreateGitHubAdapter.mockReturnValue({});
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
    mockGetWorkspaceChatTaskConfig.mockReturnValue({
      taskId: "chat.workspace",
      maxSteps: 10,
    });
    mockCreateWorkspaceChatAgentResponse.mockResolvedValue(new Response("ok"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("503 — deployment LLM config", () => {
    it("returns 503 when server OpenRouter config is missing", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "");
      const res = await POST(makeRequest());
      expect(res.status).toBe(503);
      expect((await res.json()).error).toContain("AI service is unavailable");
      expect(mockCreateWorkspaceChatAgentResponse).not.toHaveBeenCalled();
    });
  });

  describe("credential headers", () => {
    it("continues AKB-only when Authorization (GitHub) header is missing", async () => {
      const res = await POST(makeRequest({ auth: null }));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
      const args = mockCreateWorkspaceChatAgentResponse.mock.calls[0]?.[0];
      expect(args.githubAdapter).toBeUndefined();
    });

    it("returns 401 when Authorization (GitHub) header is malformed", async () => {
      const res = await POST(makeRequest({ auth: "Token ghp_token" }));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toContain("GitHub");
      expect(mockCreateWorkspaceChatAgentResponse).not.toHaveBeenCalled();
    });

    it("returns 401 when X-Reef-Vault header is missing", async () => {
      const res = await POST(makeRequest({ vault: null }));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toContain("X-Reef-Vault");
    });

    it("returns 401 when X-Reef-Vault is malformed (regex reject)", async () => {
      const res = await POST(makeRequest({ vault: "Bad/Vault Name" }));
      expect(res.status).toBe(401);
    });

    it("returns 401 when session cookie is missing", async () => {
      const res = await POST(makeRequest({ cookie: null }));
      expect(res.status).toBe(401);
    });

    it("returns 401 when session cookie JWT is expired", async () => {
      const pastExp = Math.floor(Date.now() / 1000) - 60;
      const expiredJwt = makeJwt({ exp: pastExp });
      const res = await POST(
        makeRequest({ cookie: `${SESSION_COOKIE}=${expiredJwt}` }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("400 — body validation", () => {
    it("returns 400 when JSON body is malformed", async () => {
      const req = new Request("http://localhost/api/chat", {
        method: "POST",
        headers: {
          authorization: "Bearer ghp_token",
          [VAULT_HEADER.toLowerCase()]: "reef-acme",
          cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
        },
        body: "{ not-json",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when body shape fails ChatRequestBodySchema", async () => {
      const res = await POST(makeRequest({ body: { messages: [] } }));
      expect(res.status).toBe(400);
    });
  });

  describe("happy path — workspace chat task delegation", () => {
    it("uses chat.workspace registry config for route telemetry", async () => {
      await POST(makeRequest());
      expect(mockGetWorkspaceChatTaskConfig).toHaveBeenCalledTimes(1);
    });

    it("creates per-request adapters (github + akb + llm) inside the handler", async () => {
      await POST(makeRequest());
      expect(mockCreateLlmAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "sk-test",
          baseUrl: "https://api.example.com",
          model: "gpt-4o-mini",
        }),
      );
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: "ghp_token",
      });
      expect(mockCreateAkbAdapter).toHaveBeenCalledTimes(1);
    });

    it("delegates workspace chat execution to core with request-scoped inputs", async () => {
      await POST(makeRequest({ vault: "reef-acme" }));
      expect(mockCreateWorkspaceChatAgentResponse).toHaveBeenCalledTimes(1);
      const args = mockCreateWorkspaceChatAgentResponse.mock.calls[0]?.[0];
      expect(args).toEqual(
        expect.objectContaining({
          vault: "reef-acme",
          messages: VALID_BODY.messages,
        }),
      );
      expect(args.adapter).toBeDefined();
      expect(args.githubAdapter).toBeDefined();
      expect(args.llmAdapter).toBeDefined();
      expect(typeof args.onStepFinish).toBe("function");
      expect(typeof args.onFinish).toBe("function");
      expect(typeof args.onError).toBe("function");
    });

    it("forwards the validated UIMessage list to the workspace chat task", async () => {
      await POST(makeRequest());
      const call = mockCreateWorkspaceChatAgentResponse.mock.calls[0]?.[0];
      expect(call?.messages).toEqual(VALID_BODY.messages);
    });

    it("normalizes older no-id chat messages before delegation", async () => {
      await POST(
        makeRequest({
          body: {
            messages: [
              {
                role: "user",
                parts: [{ type: "text", text: "hello" }],
              },
            ],
          },
        }),
      );

      const call = mockCreateWorkspaceChatAgentResponse.mock.calls[0]?.[0];
      expect(call?.messages).toEqual([
        {
          id: "chat-message-0",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        },
      ]);
    });

    it("does not invoke workspace chat when required credentials fail", async () => {
      await POST(makeRequest({ vault: null }));
      expect(mockCreateWorkspaceChatAgentResponse).not.toHaveBeenCalled();
    });
  });
});
