// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/telemetry", () => ({
  tracer: {
    startActiveSpan: vi.fn(
      async (
        _name: string,
        fn: (span: {
          setAttribute: () => void;
          recordException: () => void;
          setStatus: () => void;
          end: () => void;
        }) => Promise<unknown>,
      ) =>
        fn({
          setAttribute: () => {},
          recordException: () => {},
          setStatus: () => {},
          end: () => {},
        }),
    ),
  },
}));

const {
  mockAkbReadIssue,
  mockAkbUpdateIssue,
  mockAkbDeleteIssue,
  mockCreateAkbAdapter,
} = vi.hoisted(() => ({
  mockAkbReadIssue: vi.fn(),
  mockAkbUpdateIssue: vi.fn(),
  mockAkbDeleteIssue: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbReadIssue: mockAkbReadIssue,
    akbUpdateIssue: mockAkbUpdateIssue,
    akbDeleteIssue: mockAkbDeleteIssue,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import {
  AuthError,
  ConflictError,
  type IssueMetadata,
  NotFoundError,
} from "@reef/core";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { DELETE, GET, PATCH } from "./route";

const SAMPLE_ISSUE: IssueMetadata = {
  id: "REEF-001",
  title: "Sample",
  status: "todo",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
};

function authedHeaders(): Record<string, string> {
  return {
    cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
    "content-type": "application/json",
  };
}

const params = (id: string) =>
  ({ params: Promise.resolve({ id }) }) as { params: Promise<{ id: string }> };

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

describe("GET /api/issues/[id]", () => {
  it("returns 400 when id does not match PREFIX-NUMBER", async () => {
    const req = new Request(
      "http://localhost/api/issues/bad-id?vault=reef-acme",
      { headers: authedHeaders() },
    );
    const res = await GET(req, params("bad-id"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when vault param is missing", async () => {
    const req = new Request("http://localhost/api/issues/REEF-001", {
      headers: authedHeaders(),
    });
    const res = await GET(req, params("REEF-001"));
    expect(res.status).toBe(400);
  });

  it("returns 401 when session cookie is missing", async () => {
    const req = new Request(
      "http://localhost/api/issues/REEF-001?vault=reef-acme",
    );
    const res = await GET(req, params("REEF-001"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with { issue, content } on happy path", async () => {
    mockAkbReadIssue.mockResolvedValueOnce({
      issue: SAMPLE_ISSUE,
      content: "## body",
      path: "issues/reef-001.md",
      commit_hash: "abc",
    });
    const req = new Request(
      "http://localhost/api/issues/REEF-001?vault=reef-acme",
      { headers: authedHeaders() },
    );
    const res = await GET(req, params("REEF-001"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      issue: SAMPLE_ISSUE,
      content: "## body",
    });
    expect(mockAkbReadIssue).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-acme", id: "REEF-001" }),
    );
  });

  it("translates NotFoundError to 404 with issue label", async () => {
    mockAkbReadIssue.mockRejectedValueOnce(
      new NotFoundError({ resource: "issue REEF-999" }),
    );
    const req = new Request(
      "http://localhost/api/issues/REEF-999?vault=reef-acme",
      { headers: authedHeaders() },
    );
    const res = await GET(req, params("REEF-999"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("Issue not found");
  });
});

describe("PATCH /api/issues/[id]", () => {
  const VALID_BODY = {
    vault: "reef-acme",
    update: {
      issue_id: "REEF-001",
      patch: { status: "in_progress" as const },
    },
  };

  it("returns 400 when id does not match PREFIX-NUMBER", async () => {
    const req = new Request("http://localhost/api/issues/bad-id", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify(VALID_BODY),
    });
    const res = await PATCH(req, params("bad-id"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is invalid JSON", async () => {
    const req = new Request("http://localhost/api/issues/REEF-001", {
      method: "PATCH",
      headers: authedHeaders(),
      body: "{ not-json",
    });
    const res = await PATCH(req, params("REEF-001"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when body fails UpdateIssueRequestSchema (missing vault)", async () => {
    const req = new Request("http://localhost/api/issues/REEF-001", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify({
        update: { issue_id: "REEF-001", patch: { status: "in_progress" } },
      }),
    });
    const res = await PATCH(req, params("REEF-001"));
    expect(res.status).toBe(400);
  });

  it("rejects older planning text fields in issue patch bodies", async () => {
    const req = new Request("http://localhost/api/issues/REEF-001", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify({
        vault: "reef-acme",
        update: { issue_id: "REEF-001", patch: { sprint: "Sprint 1" } },
      }),
    });
    const res = await PATCH(req, params("REEF-001"));
    expect(res.status).toBe(400);
    expect(mockAkbUpdateIssue).not.toHaveBeenCalled();
  });

  it("passes planning id fields in issue patch bodies", async () => {
    mockAkbUpdateIssue.mockResolvedValueOnce({
      commit_hash: "def5678",
      issue: {
        ...SAMPLE_ISSUE,
        sprint_id: "11111111-1111-4111-8111-111111111111",
      },
      content: "## body",
    });
    const req = new Request("http://localhost/api/issues/REEF-001", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify({
        vault: "reef-acme",
        update: {
          issue_id: "REEF-001",
          patch: {
            sprint_id: "11111111-1111-4111-8111-111111111111",
          },
        },
      }),
    });
    const res = await PATCH(req, params("REEF-001"));
    expect(res.status).toBe(200);
    const callArgs = mockAkbUpdateIssue.mock.calls[0]?.[0];
    expect(callArgs.partial.sprint_id).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("calls akbUpdateIssue and returns 200 with merged issue + content", async () => {
    const updated = { ...SAMPLE_ISSUE, status: "in_progress" as const };
    mockAkbUpdateIssue.mockResolvedValueOnce({
      commit_hash: "def5678",
      issue: updated,
      content: "## body",
    });

    const req = new Request("http://localhost/api/issues/REEF-001", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify({
        vault: "reef-acme",
        update: {
          issue_id: "REEF-001",
          patch: { status: "in_progress" },
          content: "## body",
        },
      }),
    });
    const res = await PATCH(req, params("REEF-001"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ issue: updated, content: "## body" });

    expect(mockAkbUpdateIssue).toHaveBeenCalledTimes(1);
    const callArgs = mockAkbUpdateIssue.mock.calls[0]?.[0];
    expect(callArgs.vault).toBe("reef-acme");
    expect(callArgs.id).toBe("REEF-001");
    expect(callArgs.content).toBe("## body");
    // Route stamps updated_at on every patch so list ordering reacts.
    expect(typeof callArgs.partial.updated_at).toBe("string");
    expect(callArgs.partial.updated_by).toBe("carol");
    expect(callArgs.partial.status).toBe("in_progress");
    expect(callArgs.partial.source).toBeUndefined();
  });

  it("does NOT pass content when caller omits it (preserves existing body)", async () => {
    mockAkbUpdateIssue.mockResolvedValueOnce({
      commit_hash: "x",
      issue: SAMPLE_ISSUE,
      content: "## existing",
    });

    const req = new Request("http://localhost/api/issues/REEF-001", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify(VALID_BODY),
    });
    await PATCH(req, params("REEF-001"));

    const callArgs = mockAkbUpdateIssue.mock.calls[0]?.[0];
    expect(callArgs.content).toBeUndefined();
  });

  it("translates ConflictError to 409 (akb LWW race)", async () => {
    mockAkbUpdateIssue.mockRejectedValueOnce(new ConflictError({}));
    const req = new Request("http://localhost/api/issues/REEF-001", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify(VALID_BODY),
    });
    const res = await PATCH(req, params("REEF-001"));
    expect(res.status).toBe(409);
  });

  it("translates AuthError to 401", async () => {
    mockAkbUpdateIssue.mockRejectedValueOnce(new AuthError({}));
    const req = new Request("http://localhost/api/issues/REEF-001", {
      method: "PATCH",
      headers: authedHeaders(),
      body: JSON.stringify(VALID_BODY),
    });
    const res = await PATCH(req, params("REEF-001"));
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/issues/[id]", () => {
  it("returns 400 when id does not match PREFIX-NUMBER", async () => {
    const req = new Request(
      "http://localhost/api/issues/bad-id?vault=reef-acme",
      { method: "DELETE", headers: authedHeaders() },
    );
    const res = await DELETE(req, params("bad-id"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when vault param is missing", async () => {
    const req = new Request("http://localhost/api/issues/REEF-001", {
      method: "DELETE",
      headers: authedHeaders(),
    });
    const res = await DELETE(req, params("REEF-001"));
    expect(res.status).toBe(400);
  });

  it("returns 401 when session cookie is missing", async () => {
    const req = new Request(
      "http://localhost/api/issues/REEF-001?vault=reef-acme",
      { method: "DELETE" },
    );
    const res = await DELETE(req, params("REEF-001"));
    expect(res.status).toBe(401);
  });

  it("returns 204 on successful delete", async () => {
    mockAkbDeleteIssue.mockResolvedValueOnce(undefined);
    const req = new Request(
      "http://localhost/api/issues/REEF-001?vault=reef-acme",
      { method: "DELETE", headers: authedHeaders() },
    );
    const res = await DELETE(req, params("REEF-001"));
    expect(res.status).toBe(204);
    expect(mockAkbDeleteIssue).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-acme", id: "REEF-001" }),
    );
  });

  it("translates NotFoundError to 404", async () => {
    mockAkbDeleteIssue.mockRejectedValueOnce(
      new NotFoundError({ resource: "issue REEF-999" }),
    );
    const req = new Request(
      "http://localhost/api/issues/REEF-999?vault=reef-acme",
      { method: "DELETE", headers: authedHeaders() },
    );
    const res = await DELETE(req, params("REEF-999"));
    expect(res.status).toBe(404);
  });
});
