// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnrichIssue, mockGetAkbAdapter, mockReadAuthoringLanguage } =
  vi.hoisted(() => ({
    mockEnrichIssue: vi.fn(),
    mockGetAkbAdapter: vi.fn(),
    mockReadAuthoringLanguage: vi.fn(),
  }));

vi.mock("@reef/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@reef/core")>();
  return {
    ...original,
    enrichIssue: mockEnrichIssue,
    akbReadAuthoringLanguage: mockReadAuthoringLanguage,
  };
});

vi.mock("@/lib/api/requestHelpers", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api/requestHelpers")>();
  return {
    ...original,
    getAkbAdapter: mockGetAkbAdapter,
  };
});

import {
  AkbApiError,
  AuthError,
  LlmError,
  NotFoundError,
  SchemaValidationError,
} from "@reef/core";
import { POST } from "./route";

const VALID_BODY = {
  issueId: "REEF-001",
  vault: "reef-acme",
  draft: {
    fields: {
      title: "Fix login bug",
      issue_type: "bug",
      priority: null,
      assigned_to: null,
      requester: null,
      reporter: null,
      start_date: null,
      due_date: null,
      milestone_id: null,
      sprint_id: null,
      release_id: null,
      estimate_points: null,
      severity: null,
      parent_id: null,
      labels: [],
      depends_on: [],
      blocks: [],
      related_to: [],
      external_refs: [],
    },
    content: "Users can't log in after OAuth token expiry.",
  },
  repoContext: {
    owner: "octo",
    repo: "cat",
  },
};

function makeRequest(opts: {
  body?: unknown;
  headers?: Record<string, string>;
}): Request {
  return new Request("http://localhost/api/enrich", {
    method: "POST",
    body: JSON.stringify(opts.body ?? VALID_BODY),
    headers: opts.headers ?? {
      "Content-Type": "application/json",
    },
  });
}

describe("POST /api/enrich", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
    vi.stubEnv("OPENROUTER_BASE_URL", "https://api.openai.com/v1");
    vi.stubEnv("REEF_LLM_MODEL", "gpt-4o");
    mockGetAkbAdapter.mockReturnValue({ adapter: { request: vi.fn() } });
    mockReadAuthoringLanguage.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 200 with the enrichment result on happy path", async () => {
    const result = {
      suggestions: [
        {
          field: "priority",
          value: "high",
          reasoning: "Affects all users.",
          confidence: 0.9,
        },
      ],
    };
    mockEnrichIssue.mockResolvedValueOnce(result);

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(mockEnrichIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          issueId: "REEF-001",
          vault: "reef-acme",
          draft: expect.objectContaining({
            fields: expect.objectContaining({ title: "Fix login bug" }),
          }),
        }),
      }),
    );
  });

  it("reads the workspace authoring language and passes it to enrichIssue (REEF-136)", async () => {
    mockReadAuthoringLanguage.mockResolvedValueOnce("ko");
    mockEnrichIssue.mockResolvedValueOnce({ suggestions: [] });

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(200);
    expect(mockReadAuthoringLanguage).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-acme" }),
    );
    expect(mockEnrichIssue).toHaveBeenCalledWith(
      expect.objectContaining({ authoringLanguage: "ko" }),
    );
  });

  it("returns 400 on invalid JSON body", async () => {
    const req = new Request("http://localhost/api/enrich", {
      method: "POST",
      body: "not json",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("continues without GitHub code tools when the GitHub App is not configured", async () => {
    const result = { suggestions: [] };
    mockEnrichIssue.mockResolvedValueOnce(result);

    const res = await POST(
      makeRequest({
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(mockEnrichIssue).toHaveBeenCalledWith(
      expect.not.objectContaining({
        githubAdapter: expect.anything(),
      }),
    );
  });

  it("returns 401 when the workspace session is missing", async () => {
    mockGetAkbAdapter.mockReturnValueOnce({
      response: Response.json(
        { error: "Your session has expired." },
        { status: 401 },
      ),
    });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Workspace session/i);
  });

  it("preserves session-clearing headers from an expired workspace session", async () => {
    mockGetAkbAdapter.mockReturnValueOnce({
      response: Response.json(
        { error: "Your session has expired." },
        {
          status: 401,
          headers: {
            "Set-Cookie": "__reef_session=; Path=/; Max-Age=0",
            "Cache-Control": "no-store",
          },
        },
      ),
    });

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toContain("__reef_session=");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 400 on schema validation failure", async () => {
    const res = await POST(makeRequest({ body: { issueId: "" } }));
    expect(res.status).toBe(400);
  });

  it("returns 503 when deployment OpenRouter config is missing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/deployment/i);
  });

  it("returns 503 with a PM-vocabulary message on LlmError", async () => {
    mockEnrichIssue.mockRejectedValueOnce(
      new LlmError({ message: "rate limited" }),
    );
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/unavailable/i);
  });

  it("returns 401 when core detects an invalid workspace session", async () => {
    mockEnrichIssue.mockRejectedValueOnce(
      new AuthError({ message: "workspace token expired" }),
    );
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Workspace session/i);
  });

  it("preserves an AKB account denial and clears the established session", async () => {
    mockEnrichIssue.mockRejectedValueOnce(
      new AuthError({
        origin: "akb",
        code: "account_suspended",
        status: 403,
        message: "account suspended",
      }),
    );

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/suspended/i);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__reef_session=");
    expect(setCookie).toContain("__reef_sso=");
    expect(setCookie).toContain("Max-Age=0");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 404 when core cannot find the requested workspace resource", async () => {
    mockEnrichIssue.mockRejectedValueOnce(
      new NotFoundError({ resource: "vault" }),
    );
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/vault/i);
  });

  it("passes a workspace backend 403 straight through (REEF-054 canonical)", async () => {
    mockEnrichIssue.mockRejectedValueOnce(
      new AkbApiError({ status: 403, message: "forbidden" }),
    );
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("authentication");
  });

  it("maps untrusted request context to 422 (REEF-054 canonical status)", async () => {
    mockEnrichIssue.mockRejectedValueOnce(
      new SchemaValidationError({
        field: "repoContext",
        issues: ["repoContext must reference monitored_repos"],
      }),
    );
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(422);
  });

  it("returns 500 when the core function throws an unexpected error", async () => {
    mockEnrichIssue.mockRejectedValueOnce(new Error("kaboom"));
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(500);
  });
});
