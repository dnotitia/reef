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

const { mockListComments, mockCreateComment, mockGetActor, mockCreateAdapter } =
  vi.hoisted(() => ({
    mockListComments: vi.fn(),
    mockCreateComment: vi.fn(),
    mockGetActor: vi.fn(),
    mockCreateAdapter: vi.fn(),
  }));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbListComments: mockListComments,
    akbCreateComment: mockCreateComment,
    akbGetCurrentActor: mockGetActor,
    createAkbAdapter: mockCreateAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../../../__test-helpers__/jwt";
import { GET, POST } from "./route";

const COMMENT = {
  id: "11111111-1111-4111-8111-111111111111",
  reef_id: "REEF-001",
  body: "a comment",
  author: "alice",
  created_at: "2026-06-18T01:00:00.000Z",
  edited_at: null,
};

function authedHeaders(): Record<string, string> {
  return {
    cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
    "content-type": "application/json",
  };
}

function params(id = "REEF-001") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAdapter.mockReturnValue({ request: vi.fn() });
  mockGetActor.mockResolvedValue({ actor: "alice" });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("GET /api/issues/[id]/comments", () => {
  it("returns the issue's comments", async () => {
    mockListComments.mockResolvedValue([COMMENT]);

    const res = await GET(
      new Request("http://localhost/api/issues/REEF-001/comments?vault=v", {
        headers: authedHeaders(),
      }),
      params(),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ comments: [COMMENT] });
    expect(mockListComments).toHaveBeenCalledWith(
      expect.anything(),
      "v",
      "REEF-001",
    );
  });

  it("400s without a vault param", async () => {
    const res = await GET(
      new Request("http://localhost/api/issues/REEF-001/comments", {
        headers: authedHeaders(),
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(mockListComments).not.toHaveBeenCalled();
  });

  it("400s on a malformed issue id", async () => {
    const res = await GET(
      new Request("http://localhost/api/issues/nope/comments?vault=v", {
        headers: authedHeaders(),
      }),
      params("not an id"),
    );
    expect(res.status).toBe(400);
    expect(mockListComments).not.toHaveBeenCalled();
  });
});

describe("POST /api/issues/[id]/comments", () => {
  it("creates a comment from the session actor and returns it 201", async () => {
    mockCreateComment.mockResolvedValue(COMMENT);

    const res = await POST(
      new Request("http://localhost/api/issues/REEF-001/comments?vault=v", {
        method: "POST",
        headers: authedHeaders(),
        body: JSON.stringify({ body: "a comment" }),
      }),
      params(),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ comment: COMMENT });
    // Author is the session actor, not the request body.
    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.anything(),
      "v",
      "REEF-001",
      "a comment",
      "alice",
    );
  });

  it("400s an empty body", async () => {
    const res = await POST(
      new Request("http://localhost/api/issues/REEF-001/comments?vault=v", {
        method: "POST",
        headers: authedHeaders(),
        body: JSON.stringify({ body: "   " }),
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(mockCreateComment).not.toHaveBeenCalled();
  });

  it("400s invalid JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/issues/REEF-001/comments?vault=v", {
        method: "POST",
        headers: authedHeaders(),
        body: "not json",
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(mockCreateComment).not.toHaveBeenCalled();
  });
});
