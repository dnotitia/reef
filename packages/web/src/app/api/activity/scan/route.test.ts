// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnsureReefTables,
  mockListActivitySuggestions,
  mockReadAuthoringLanguage,
  mockScanActivity,
  mockWriteActivitySuggestion,
} = vi.hoisted(() => ({
  mockEnsureReefTables: vi.fn(),
  mockListActivitySuggestions: vi.fn(),
  mockReadAuthoringLanguage: vi.fn(),
  mockScanActivity: vi.fn(),
  mockWriteActivitySuggestion: vi.fn(),
}));

vi.mock("@reef/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@reef/core")>();
  return {
    ...original,
    akbEnsureReefTables: mockEnsureReefTables,
    akbListActivitySuggestions: mockListActivitySuggestions,
    akbReadAuthoringLanguage: mockReadAuthoringLanguage,
    scanActivity: mockScanActivity,
    akbWriteActivitySuggestion: mockWriteActivitySuggestion,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AkbApiError, AuthError } from "@reef/core";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { POST } from "./route";

const VALID_BODY = {
  owner: "octo",
  repo: "cat",
  vault: "reef-octocat",
  since: "2026-05-08T08:00:00.000Z",
  projectPrefix: "REEF",
};

const VALID_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Authorization: "Bearer ghp_test",
  cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
};

function makeRequest(opts: {
  body?: unknown;
  headers?: Record<string, string>;
}): Request {
  return new Request("http://localhost/api/activity/scan", {
    method: "POST",
    body: JSON.stringify(opts.body ?? VALID_BODY),
    headers: opts.headers ?? VALID_HEADERS,
  });
}

describe("POST /api/activity/scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
    vi.stubEnv("OPENROUTER_BASE_URL", "https://api.openai.com/v1");
    vi.stubEnv("REEF_LLM_MODEL", "gpt-4o");
    mockEnsureReefTables.mockResolvedValue(undefined);
    mockListActivitySuggestions.mockResolvedValue({ suggestions: [] });
    mockReadAuthoringLanguage.mockResolvedValue(null);
    mockWriteActivitySuggestion.mockResolvedValue({
      path: "_reef/activity-inbox/suggestion.md",
      commit_hash: "abc123",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 200 with added suggestion counts on happy path", async () => {
    const draftFixture = [
      {
        id: "00000000-0000-0000-0000-000000000001",
        proposal: {
          operation: "create",
          create: {
            fields: { title: "Add login flow" },
            content: "auto",
          },
        },
        provenance: {
          type: "commit",
          ref: "abc",
          repo: "octo/cat",
          actor: "alice",
          detectedAt: "2026-05-08T10:00:00.000Z",
        },
        confidence: 0.8,
        reasoning: "test",
        status: "pending",
        createdAt: "2026-05-08T10:00:00.000Z",
      },
    ];
    const statusChangeFixture = [
      {
        id: "00000000-0000-0000-0000-000000000002",
        proposal: {
          operation: "update",
          update: {
            issue_id: "REEF-042",
            patch: { status: "done" },
          },
        },
        issueTitle: "Login bug",
        fromStatus: "in_review",
        rationale: "The PR fixing the login bug was merged.",
        evidence: [
          {
            type: "commit",
            ref: "def456",
            repo: "octo/cat",
            actor: "bob",
          },
        ],
        confidence: 0.9,
        detectedAt: "2026-05-08T10:00:00.000Z",
        status: "pending",
        createdAt: "2026-05-08T10:00:00.000Z",
      },
    ];
    mockScanActivity.mockResolvedValueOnce({
      drafts: draftFixture,
      statusChanges: statusChangeFixture,
    });

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      addedDrafts: 1,
      addedStatusChanges: 1,
      scannedAt: expect.any(String),
    });
    expect(mockScanActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "octo",
        repo: "cat",
        vault: "reef-octocat",
        since: "2026-05-08T08:00:00.000Z",
        projectPrefix: "REEF",
        akbAdapter: expect.anything(),
      }),
    );
    expect(mockWriteActivitySuggestion).toHaveBeenCalledTimes(2);
  });

  it("suppresses existing AKB suggestion refs before calling the LLM", async () => {
    mockListActivitySuggestions.mockResolvedValueOnce({
      suggestions: [
        {
          id: "reef-draft-0123456789abcdef",
          kind: "draft",
          status: "dismissed",
          fingerprint: "octo/cat:commit:abc",
          repo: "octo/cat",
          created_at: "2026-05-08T10:00:00.000Z",
          detected_at: "2026-05-08T10:00:00.000Z",
          proposal: {
            operation: "create",
            create: {
              fields: { title: "Existing" },
              content: "Existing",
            },
          },
          provenance: {
            type: "commit",
            ref: "abc",
            repo: "octo/cat",
            actor: "alice",
            detectedAt: "2026-05-08T10:00:00.000Z",
          },
          confidence: 0.8,
          reasoning: "test",
        },
      ],
    });
    mockScanActivity.mockResolvedValueOnce({ drafts: [], statusChanges: [] });

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(200);
    expect(mockScanActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        dismissedRefs: expect.arrayContaining(["octo/cat:commit:abc"]),
      }),
    );
  });

  it("returns 400 on invalid JSON body", async () => {
    const req = new Request("http://localhost/api/activity/scan", {
      method: "POST",
      body: "not json",
      headers: VALID_HEADERS,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 on schema validation failure", async () => {
    const res = await POST(makeRequest({ body: { owner: "" } }));
    expect(res.status).toBe(400);
  });

  it("returns 401 when the session cookie is missing", async () => {
    const res = await POST(
      makeRequest({
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer ghp_test",
        },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await POST(
      makeRequest({
        headers: {
          "Content-Type": "application/json",
          cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
        },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 503 when deployment OpenRouter config is missing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const res = await POST(
      makeRequest({
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer ghp_test",
          cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
        },
      }),
    );
    expect(res.status).toBe(503);
  });

  it("returns 500 with a generic message for an unexpected error (no raw leak)", async () => {
    mockScanActivity.mockRejectedValueOnce(new Error("LLM 429"));
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(500);
    // translateError hides the raw technical message behind PM vocabulary.
    expect(await res.json()).toEqual({
      error: "An unexpected error occurred.",
    });
  });

  it("maps a typed AkbApiError to its HTTP status instead of a flat 500", async () => {
    mockScanActivity.mockRejectedValueOnce(
      new AkbApiError({ status: 404, message: "vault gone" }),
    );
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(404);
  });

  it("maps a typed AuthError to 401", async () => {
    mockScanActivity.mockRejectedValueOnce(new AuthError({ message: "bad" }));
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
  });
});
