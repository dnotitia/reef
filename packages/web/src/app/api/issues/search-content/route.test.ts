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

const { mockSearchIssueContent, mockCreateAkbAdapter } = vi.hoisted(() => ({
  mockSearchIssueContent: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbSearchIssueContent: mockSearchIssueContent,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AuthError } from "@reef/core";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { GET } from "./route";

function request(path: string, authenticated = true): Request {
  return new Request(`http://localhost${path}`, {
    headers: authenticated
      ? { cookie: `${SESSION_COOKIE}=${VALID_JWT}` }
      : undefined,
  });
}

beforeEach(() => {
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("GET /api/issues/search-content", () => {
  it("trims a valid query and returns schema-conforming content hits", async () => {
    const adapter = { request: vi.fn() };
    mockCreateAkbAdapter.mockReturnValue(adapter);
    mockSearchIssueContent.mockResolvedValue({
      results: [
        {
          reef_id: "REEF-347",
          title: "Content search",
          snippet: "한국어 본문",
          source: "body",
          score: 0.7,
          match_id: "body:akb://reef-test/coll/issues/doc/reef-347.md",
        },
      ],
      has_more: true,
    });

    const response = await GET(
      request(
        "/api/issues/search-content?vault=reef-test&q=%20%ED%95%9C%EA%B5%AD%EC%96%B4%20&limit=10",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [
        expect.objectContaining({
          reef_id: "REEF-347",
          source: "body",
          score: 0.7,
        }),
      ],
      has_more: true,
    });
    expect(mockSearchIssueContent).toHaveBeenCalledWith({
      adapter,
      vault: "reef-test",
      query: "한국어",
      limit: 10,
    });
  });

  it.each([
    "/api/issues/search-content?vault=reef-test&q=a&limit=10",
    "/api/issues/search-content?vault=reef-test&q=%20%20&limit=10",
    "/api/issues/search-content?vault=reef-test&q=okay&limit=11",
    "/api/issues/search-content?vault=reef-test&q=okay&limit=abc",
    "/api/issues/search-content?vault=reef-test&q=okay",
    `/api/issues/search-content?vault=reef-test&q=${"a".repeat(181)}&limit=10`,
  ])(
    "returns 400 without touching core for invalid input: %s",
    async (path) => {
      const response = await GET(request(path));
      expect(response.status).toBe(400);
      expect(mockSearchIssueContent).not.toHaveBeenCalled();
    },
  );

  it("returns 400 without a valid vault", async () => {
    const response = await GET(
      request("/api/issues/search-content?q=okay&limit=10"),
    );
    expect(response.status).toBe(400);
  });

  it("preserves the shared authentication boundary", async () => {
    const response = await GET(
      request(
        "/api/issues/search-content?vault=reef-test&q=okay&limit=10",
        false,
      ),
    );
    expect(response.status).toBe(401);
    expect(mockSearchIssueContent).not.toHaveBeenCalled();
  });

  it("clears established auth cookies on an AKB account denial", async () => {
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
    mockSearchIssueContent.mockRejectedValue(
      new AuthError({
        origin: "akb",
        code: "membership_required",
        status: 403,
      }),
    );
    const response = await GET(
      request("/api/issues/search-content?vault=reef-test&q=okay&limit=10"),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toContain("__reef_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("x-reef-account-error")).toBe(
      "membership_required",
    );
  });
});
