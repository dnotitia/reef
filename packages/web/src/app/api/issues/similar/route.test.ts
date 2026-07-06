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

const { mockSearchSimilarIssues, mockCreateAkbAdapter } = vi.hoisted(() => ({
  mockSearchSimilarIssues: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbSearchSimilarIssues: mockSearchSimilarIssues,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { GET } from "./route";

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

beforeEach(() => {
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("GET /api/issues/similar", () => {
  it("searches similar issues through core and returns the top hits", async () => {
    const adapter = { request: vi.fn() };
    mockCreateAkbAdapter.mockReturnValue(adapter);
    mockSearchSimilarIssues.mockResolvedValue([
      {
        id: "REEF-022",
        title: "AI draft duplicate detection misses old issues",
        status: "todo",
        issue_type: "bug",
        score: 0.032,
      },
    ]);

    const res = await GET(
      new Request(
        "http://localhost/api/issues/similar?vault=reef-test&q=duplicate%20draft&limit=99",
        { headers: authedHeaders() },
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      issues: [
        {
          id: "REEF-022",
          title: "AI draft duplicate detection misses old issues",
          status: "todo",
          issue_type: "bug",
          score: 0.032,
        },
      ],
    });
    expect(mockSearchSimilarIssues).toHaveBeenCalledWith({
      adapter,
      vault: "reef-test",
      title: "duplicate draft",
      limit: 5,
    });
  });

  it("short-circuits titles shorter than three characters without an akb call", async () => {
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });

    const res = await GET(
      new Request("http://localhost/api/issues/similar?vault=reef-test&q=ab", {
        headers: authedHeaders(),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ issues: [] });
    expect(mockCreateAkbAdapter).not.toHaveBeenCalled();
    expect(mockSearchSimilarIssues).not.toHaveBeenCalled();
  });

  it("400s without a vault param", async () => {
    const res = await GET(
      new Request("http://localhost/api/issues/similar?q=duplicate", {
        headers: authedHeaders(),
      }),
    );
    expect(res.status).toBe(400);
  });
});
