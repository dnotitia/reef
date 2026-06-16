// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const { mockAkbAllocateNextIssueId, mockAkbWriteIssue, mockCreateAkbAdapter } =
  vi.hoisted(() => ({
    mockAkbAllocateNextIssueId: vi.fn(),
    mockAkbWriteIssue: vi.fn(),
    mockCreateAkbAdapter: vi.fn(),
  }));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbAllocateNextIssueId: mockAkbAllocateNextIssueId,
    akbWriteIssue: mockAkbWriteIssue,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AuthError, ConflictError, SchemaValidationError } from "@reef/core";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { POST } from "./route";

function authedHeaders(): Record<string, string> {
  return {
    cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
    "content-type": "application/json",
  };
}

const VALID_BODY = {
  vault: "reef-acme",
  prefix: "REEF",
  create: { fields: { title: "New issue" }, content: "## body" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  // The current actor is resolved through core `akbGetCurrentActor`, which calls
  // `adapter.request("/api/v1/auth/me")` — so the per-request adapter returns the
  // public profile (REEF-052; previously this route helper hit global fetch).
  mockCreateAkbAdapter.mockReturnValue({
    request: vi.fn(async () => ({ username: "carol" })),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/drafts/approve", () => {
  it("returns 400 when JSON body is malformed", async () => {
    const req = new Request("http://localhost/api/drafts/approve", {
      method: "POST",
      headers: authedHeaders(),
      body: "{ not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when body fails ApproveDraftRequestSchema", async () => {
    const req = new Request("http://localhost/api/drafts/approve", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify({ vault: "reef-acme" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when session cookie is missing", async () => {
    const req = new Request("http://localhost/api/drafts/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("allocates next id, writes issue, returns 201 + { issueId }", async () => {
    mockAkbAllocateNextIssueId.mockResolvedValueOnce("REEF-042");
    mockAkbWriteIssue.mockResolvedValueOnce({
      path: "issues/reef-042.md",
      commit_hash: "abc1234",
    });

    const req = new Request("http://localhost/api/drafts/approve", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(VALID_BODY),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ issueId: "REEF-042" });

    expect(mockAkbAllocateNextIssueId).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-acme", prefix: "REEF" }),
    );
    expect(mockAkbWriteIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-acme",
        content: "## body",
        issue: expect.objectContaining({
          id: "REEF-042",
          title: "New issue",
          created_by: "carol",
          updated_by: "carol",
        }),
      }),
    );
  });

  it("rejects create input when content is omitted", async () => {
    const body = {
      vault: "reef-acme",
      prefix: "REEF",
      create: { fields: { title: "New issue" } },
    };
    const req = new Request("http://localhost/api/drafts/approve", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(body),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockAkbWriteIssue).not.toHaveBeenCalled();
  });

  it("translates ConflictError to 409", async () => {
    mockAkbAllocateNextIssueId.mockResolvedValueOnce("REEF-007");
    mockAkbWriteIssue.mockRejectedValueOnce(new ConflictError({}));
    const req = new Request("http://localhost/api/drafts/approve", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(VALID_BODY),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it("translates SchemaValidationError to 422", async () => {
    mockAkbAllocateNextIssueId.mockRejectedValueOnce(
      new SchemaValidationError({ issues: ["bad"] }),
    );
    const req = new Request("http://localhost/api/drafts/approve", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(VALID_BODY),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it("translates AuthError to 401", async () => {
    mockAkbAllocateNextIssueId.mockRejectedValueOnce(new AuthError({}));
    const req = new Request("http://localhost/api/drafts/approve", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(VALID_BODY),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
