import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock createGitHubAdapter from @reef/core
vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    createGitHubAdapter: vi.fn(),
  };
});

// Mock telemetry so spans are no-ops in tests
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

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

import { logger } from "@/lib/logging/logger";
import { AuthError, createGitHubAdapter } from "@reef/core";
import { GET } from "./route";

const mockCreateGitHubAdapter = vi.mocked(createGitHubAdapter);
const mockLogError = vi.mocked(logger.error);

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/repos", { headers });
}

function octokitHttpError(
  status: number,
  message = `HTTP ${status}`,
  responseHeaders: Record<string, string> = {},
): Error {
  return Object.assign(new Error(message), {
    name: "HttpError",
    status,
    request: {
      method: "GET",
      url: "/user/repos",
      headers: { authorization: "token ghp_secret" },
    },
    response: {
      status,
      url: "/user/repos",
      headers: responseHeaders,
      data: {},
    },
  });
}

describe("GET /api/repos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const req = makeRequest();
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Authentication required");
  });

  it("returns 401 when Authorization header is malformed (no Bearer prefix)", async () => {
    const req = makeRequest({ Authorization: "Token abc123" });
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Authentication required");
  });

  it("returns repos as { full_name, id } objects on happy path", async () => {
    mockCreateGitHubAdapter.mockReturnValue({
      rest: {
        repos: {
          listForAuthenticatedUser: vi.fn().mockResolvedValue({
            data: [
              { full_name: "owner/repo-a", id: 111 },
              { full_name: "owner/repo-b", id: 222 },
            ],
          }),
        },
      },
    } as unknown as ReturnType<typeof createGitHubAdapter>);

    const req = makeRequest({ Authorization: "Bearer ghp_validtoken" });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repos).toEqual([
      { full_name: "owner/repo-a", id: 111 },
      { full_name: "owner/repo-b", id: 222 },
    ]);
  });

  it("returns 401 when AuthError is thrown by adapter", async () => {
    mockCreateGitHubAdapter.mockReturnValue({
      rest: {
        repos: {
          listForAuthenticatedUser: vi
            .fn()
            .mockRejectedValue(new AuthError({ message: "invalid_token" })),
        },
      },
    } as unknown as ReturnType<typeof createGitHubAdapter>);

    const req = makeRequest({ Authorization: "Bearer ghp_badtoken" });
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Authentication failed");
  });

  it("returns 401 through translateError when RequestError with status 401 is thrown", async () => {
    mockCreateGitHubAdapter.mockReturnValue({
      rest: {
        repos: {
          listForAuthenticatedUser: vi
            .fn()
            .mockRejectedValue(octokitHttpError(401, "Bad credentials")),
        },
      },
    } as unknown as ReturnType<typeof createGitHubAdapter>);

    const req = makeRequest({ Authorization: "Bearer ghp_expired" });
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Authentication failed");
    expect(mockLogError).toHaveBeenCalledWith(
      { err: expect.any(Error), status: 401 },
      "list_repos failed",
    );
  });

  it("passes through RequestError 403 as GitHub 403", async () => {
    mockCreateGitHubAdapter.mockReturnValue({
      rest: {
        repos: {
          listForAuthenticatedUser: vi
            .fn()
            .mockRejectedValue(octokitHttpError(403, "rate limit exceeded")),
        },
      },
    } as unknown as ReturnType<typeof createGitHubAdapter>);

    const req = makeRequest({ Authorization: "Bearer ghp_rate_limited" });
    const res = await GET(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Authentication failed");
    expect(body.error).not.toContain("rate limit");
    expect(body.error).not.toContain("ghp_secret");
    expect(mockLogError).toHaveBeenCalledWith(
      { err: expect.any(Error), status: 403 },
      "list_repos failed",
    );
  });

  it("maps RequestError 404 through repository NotFoundError copy", async () => {
    mockCreateGitHubAdapter.mockReturnValue({
      rest: {
        repos: {
          listForAuthenticatedUser: vi
            .fn()
            .mockRejectedValue(octokitHttpError(404, "Not Found")),
        },
      },
    } as unknown as ReturnType<typeof createGitHubAdapter>);

    const req = makeRequest({ Authorization: "Bearer ghp_valid" });
    const res = await GET(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("The requested repository could not be found.");
  });

  it("maps other RequestError statuses to generic GitHub 502 copy", async () => {
    mockCreateGitHubAdapter.mockReturnValue({
      rest: {
        repos: {
          listForAuthenticatedUser: vi
            .fn()
            .mockRejectedValue(
              octokitHttpError(500, "secret upstream: token ghp_secret leaked"),
            ),
        },
      },
    } as unknown as ReturnType<typeof createGitHubAdapter>);

    const req = makeRequest({ Authorization: "Bearer ghp_valid" });
    const res = await GET(req);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe(
      "An error occurred while communicating with GitHub. Please try again.",
    );
    expect(body.error).not.toContain("(500)");
    expect(body.error).not.toContain("ghp_secret");
  });

  it("maps unexpected errors to a deterministic generic 500", async () => {
    mockCreateGitHubAdapter.mockReturnValue({
      rest: {
        repos: {
          listForAuthenticatedUser: vi
            .fn()
            .mockRejectedValue(new Error("boom")),
        },
      },
    } as unknown as ReturnType<typeof createGitHubAdapter>);

    const req = makeRequest({ Authorization: "Bearer ghp_valid" });
    const res = await GET(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("An unexpected error occurred.");
  });

  it("returns empty repos array when user has no repositories", async () => {
    mockCreateGitHubAdapter.mockReturnValue({
      rest: {
        repos: {
          listForAuthenticatedUser: vi.fn().mockResolvedValue({ data: [] }),
        },
      },
    } as unknown as ReturnType<typeof createGitHubAdapter>);

    const req = makeRequest({ Authorization: "Bearer ghp_valid" });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repos).toEqual([]);
  });

  it("forwards If-None-Match to Octokit and returns ETag header on 200", async () => {
    const listForAuthenticatedUser = vi.fn().mockResolvedValue({
      data: [{ full_name: "owner/repo-a" }],
      headers: { etag: 'W/"v2-abc"' },
    });
    mockCreateGitHubAdapter.mockReturnValue({
      rest: { repos: { listForAuthenticatedUser } },
    } as unknown as ReturnType<typeof createGitHubAdapter>);

    const req = makeRequest({
      Authorization: "Bearer ghp_valid",
      "If-None-Match": 'W/"v1-old"',
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe('W/"v2-abc"');
    // Octokit call should echo the If-None-Match header so GitHub can answer 304.
    expect(listForAuthenticatedUser).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { "if-none-match": 'W/"v1-old"' },
      }),
    );
  });

  it("returns 304 with ETag (no body) when Octokit throws RequestError status 304", async () => {
    const listForAuthenticatedUser = vi
      .fn()
      .mockRejectedValue(
        octokitHttpError(304, "Not modified", { etag: 'W/"v1-old"' }),
      );
    mockCreateGitHubAdapter.mockReturnValue({
      rest: { repos: { listForAuthenticatedUser } },
    } as unknown as ReturnType<typeof createGitHubAdapter>);

    const req = makeRequest({
      Authorization: "Bearer ghp_valid",
      "If-None-Match": 'W/"v1-old"',
    });
    const res = await GET(req);

    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe('W/"v1-old"');
    // 304 responses should not carry a body — fetch rejects ReadableStream
    // bodies on 304 anyway, but assert the contract directly.
    expect(res.body).toBeNull();
    expect(mockLogError).not.toHaveBeenCalled();
  });
});
