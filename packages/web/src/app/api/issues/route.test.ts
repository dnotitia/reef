// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockRouteLogger,
  mockRouteTelemetry,
} from "../__test-helpers__/routeMocks";

mockRouteTelemetry();
mockRouteLogger();

const { mockGetAkbCurrentActor, mockResolveOptionalActor } = vi.hoisted(() => ({
  mockGetAkbCurrentActor: vi.fn(),
  mockResolveOptionalActor: vi.fn(),
}));

vi.mock("@/lib/api/requestHelpers", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api/requestHelpers")>();
  return {
    ...original,
    getAkbCurrentActor: mockGetAkbCurrentActor,
    resolveOptionalActor: mockResolveOptionalActor,
  };
});

const {
  mockAkbAllocateNextIssueId,
  mockAkbWriteIssue,
  mockAkbListIssues,
  mockCreateAkbAdapter,
} = vi.hoisted(() => ({
  mockAkbAllocateNextIssueId: vi.fn(),
  mockAkbWriteIssue: vi.fn(),
  mockAkbListIssues: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbAllocateNextIssueId: mockAkbAllocateNextIssueId,
    akbWriteIssue: mockAkbWriteIssue,
    akbListIssues: mockAkbListIssues,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import {
  AkbApiError,
  AuthError,
  ConflictError,
  type IssueMetadata,
  NotFoundError,
  SchemaValidationError,
} from "@reef/core";
import { VALID_JWT } from "../__test-helpers__/jwt";
import { GET, POST } from "./route";

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

describe("GET /api/issues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
    mockGetAkbCurrentActor.mockResolvedValue({ actor: "carol" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 400 when vault param is missing", async () => {
    const req = new Request("http://localhost/api/issues", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when vault param is malformed", async () => {
    const req = new Request("http://localhost/api/issues?vault=BAD%20VAULT", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when session cookie is missing", async () => {
    const req = new Request("http://localhost/api/issues?vault=reef-acme");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("calls akbListIssues and returns { issues }", async () => {
    mockAkbListIssues.mockResolvedValueOnce({ issues: [SAMPLE_ISSUE] });
    const req = new Request("http://localhost/api/issues?vault=reef-acme", {
      headers: authedHeaders(),
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ issues: [SAMPLE_ISSUE] });
    expect(mockAkbListIssues).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-acme" }),
    );
  });

  it("threads a parsed list query to akbListIssues for a filtered request", async () => {
    mockAkbListIssues.mockResolvedValueOnce({ issues: [] });
    const req = new Request(
      "http://localhost/api/issues?vault=reef-acme&status=todo&status=in_progress&sort_field=due_date",
      { headers: authedHeaders() },
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const call = mockAkbListIssues.mock.calls[0]?.[0];
    expect(call.vault).toBe("reef-acme");
    expect(call.query).toMatchObject({
      status: ["todo", "in_progress"],
      sort_field: "due_date",
    });
  });

  it("threads the free-text `q` param to akbListIssues (REEF-034)", async () => {
    mockAkbListIssues.mockResolvedValueOnce({ issues: [] });
    const req = new Request(
      "http://localhost/api/issues?vault=reef-acme&q=auth%20flow&status=todo",
      { headers: authedHeaders() },
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const call = mockAkbListIssues.mock.calls[0]?.[0];
    expect(call.query).toMatchObject({ q: "auth flow", status: ["todo"] });
  });

  it("returns 400 for a malformed list query param and skips the adapter", async () => {
    const req = new Request(
      "http://localhost/api/issues?vault=reef-acme&limit=abc",
      { headers: authedHeaders() },
    );
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect(mockAkbListIssues).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed pagination cursor and skips the adapter", async () => {
    const req = new Request(
      "http://localhost/api/issues?vault=reef-acme&limit=10&cursor=not-base64-json",
      { headers: authedHeaders() },
    );
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect(mockAkbListIssues).not.toHaveBeenCalled();
  });

  it("returns the paginated envelope (next_cursor + column_counts) when limit is set", async () => {
    mockAkbListIssues.mockResolvedValueOnce({
      issues: [SAMPLE_ISSUE],
      next_cursor: "Y3Vyc29y",
    });
    const req = new Request(
      "http://localhost/api/issues?vault=reef-acme&limit=1",
      { headers: authedHeaders() },
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      issues: [SAMPLE_ISSUE],
      next_cursor: "Y3Vyc29y",
      column_counts: null,
    });
    expect(mockAkbListIssues.mock.calls[0]?.[0].query.limit).toBe(1);
  });

  it("omits the query (unfiltered full list) when no list params are present", async () => {
    mockAkbListIssues.mockResolvedValueOnce({ issues: [SAMPLE_ISSUE] });
    const req = new Request("http://localhost/api/issues?vault=reef-acme", {
      headers: authedHeaders(),
    });
    await GET(req);
    expect(mockAkbListIssues.mock.calls[0]?.[0].query).toBeUndefined();
  });

  it("resolves the actor and applies default_view when requested", async () => {
    mockResolveOptionalActor.mockResolvedValueOnce("carol");
    mockAkbListIssues.mockResolvedValueOnce({ issues: [] });
    const req = new Request(
      "http://localhost/api/issues?vault=reef-acme&default_view=true",
      { headers: authedHeaders() },
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const call = mockAkbListIssues.mock.calls[0]?.[0];
    expect(call.query.default_view).toBe(true);
    expect(call.actor).toBe("carol");
  });

  it("passes actor undefined when the default_view actor cannot be resolved", async () => {
    mockResolveOptionalActor.mockResolvedValueOnce(null);
    mockAkbListIssues.mockResolvedValueOnce({ issues: [] });
    const req = new Request(
      "http://localhost/api/issues?vault=reef-acme&default_view=true",
      { headers: authedHeaders() },
    );
    await GET(req);
    expect(mockAkbListIssues.mock.calls[0]?.[0].actor).toBeUndefined();
  });

  it("does not resolve the actor when explicit filters accompany default_view", async () => {
    mockAkbListIssues.mockResolvedValueOnce({ issues: [] });
    const req = new Request(
      "http://localhost/api/issues?vault=reef-acme&default_view=true&status=done",
      { headers: authedHeaders() },
    );
    await GET(req);
    expect(mockResolveOptionalActor).not.toHaveBeenCalled();
    expect(mockAkbListIssues.mock.calls[0]?.[0].actor).toBeUndefined();
  });

  it("translates AuthError to 401", async () => {
    mockAkbListIssues.mockRejectedValueOnce(new AuthError({}));
    const req = new Request("http://localhost/api/issues?vault=reef-acme", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("translates AkbApiError (5xx) to 502", async () => {
    mockAkbListIssues.mockRejectedValueOnce(
      new AkbApiError({ status: 500, message: "boom" }),
    );
    const req = new Request("http://localhost/api/issues?vault=reef-acme", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(502);
  });

  it("maps non-akb errors to a deterministic 500 (REEF-054 total translateError)", async () => {
    mockAkbListIssues.mockRejectedValueOnce(new Error("unrelated"));
    const req = new Request("http://localhost/api/issues?vault=reef-acme", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "An unexpected error occurred.",
    });
  });
});

describe("POST /api/issues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
    mockGetAkbCurrentActor.mockResolvedValue({ actor: "carol" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const VALID_BODY = {
    vault: "reef-acme",
    prefix: "REEF",
    create: { fields: { title: "New issue" }, content: "## body" },
  };

  it("returns 400 when JSON body is malformed", async () => {
    const req = new Request("http://localhost/api/issues", {
      method: "POST",
      headers: authedHeaders(),
      body: "{ not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when body fails CreateIssueRequestSchema", async () => {
    const req = new Request("http://localhost/api/issues", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify({ vault: "reef-acme" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when session cookie is missing", async () => {
    const req = new Request("http://localhost/api/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("happy path: allocates next id, writes issue, returns 201 + { issue }", async () => {
    mockAkbAllocateNextIssueId.mockResolvedValueOnce("REEF-007");
    mockAkbWriteIssue.mockResolvedValueOnce({
      path: "issues/reef-007.md",
      commit_hash: "abc1234",
    });
    const req = new Request("http://localhost/api/issues", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(VALID_BODY),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.issue.id).toBe("REEF-007");
    expect(body.issue.title).toBe("New issue");
    expect(body.issue.created_by).toBe("carol");
    expect(body.issue.updated_by).toBe("carol");
    expect(body.issue.source).toBe("user:create_issue");

    expect(mockAkbAllocateNextIssueId).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-acme", prefix: "REEF" }),
    );
    expect(mockAkbWriteIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-acme",
        content: "## body",
        issue: expect.objectContaining({
          created_by: "carol",
          updated_by: "carol",
          source: "user:create_issue",
        }),
      }),
    );
  });

  it("rejects older planning text fields in create fields", async () => {
    const req = new Request("http://localhost/api/issues", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify({
        ...VALID_BODY,
        create: {
          fields: { title: "New issue", sprint: "Sprint 1" },
          content: "## body",
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockAkbWriteIssue).not.toHaveBeenCalled();
  });

  it("accepts planning id fields in create fields", async () => {
    mockAkbAllocateNextIssueId.mockResolvedValueOnce("REEF-007");
    mockAkbWriteIssue.mockResolvedValueOnce({
      path: "issues/reef-007.md",
      commit_hash: "abc1234",
    });
    const req = new Request("http://localhost/api/issues", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify({
        ...VALID_BODY,
        create: {
          fields: {
            title: "New issue",
            sprint_id: "11111111-1111-4111-8111-111111111111",
            milestone_id: "22222222-2222-4222-8222-222222222222",
            release_id: "33333333-3333-4333-8333-333333333333",
            blocks: ["REEF-099"],
            external_refs: [
              { type: "url", url: "https://example.com/spec", label: "Spec" },
            ],
          },
          content: "## body",
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const writeArgs = mockAkbWriteIssue.mock.calls[0]?.[0];
    expect(writeArgs.issue).toMatchObject({
      sprint_id: "11111111-1111-4111-8111-111111111111",
      milestone_id: "22222222-2222-4222-8222-222222222222",
      release_id: "33333333-3333-4333-8333-333333333333",
      blocks: ["REEF-099"],
      external_refs: [
        { type: "url", url: "https://example.com/spec", label: "Spec" },
      ],
    });
  });

  it("translates SchemaValidationError to 422", async () => {
    mockAkbAllocateNextIssueId.mockRejectedValueOnce(
      new SchemaValidationError({ issues: ["bad shape"] }),
    );
    const req = new Request("http://localhost/api/issues", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(VALID_BODY),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it("translates ConflictError to 409", async () => {
    mockAkbAllocateNextIssueId.mockResolvedValueOnce("REEF-007");
    mockAkbWriteIssue.mockRejectedValueOnce(new ConflictError({}));
    const req = new Request("http://localhost/api/issues", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(VALID_BODY),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it("translates NotFoundError to 404 (workspace label)", async () => {
    mockAkbAllocateNextIssueId.mockRejectedValueOnce(
      new NotFoundError({ resource: "workspace" }),
    );
    const req = new Request("http://localhost/api/issues", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(VALID_BODY),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });
});
