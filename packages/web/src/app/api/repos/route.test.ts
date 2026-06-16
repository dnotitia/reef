import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    createGitHubAdapter: vi.fn(),
  };
});

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

import { logger } from "@/lib/logging/logger";
import {
  AuthError,
  GitHubApiError,
  NotFoundError,
  createGitHubAdapter,
} from "@reef/core";
import { GET } from "./route";

const mockCreateGitHubAdapter = vi.mocked(createGitHubAdapter);
const mockLogError = vi.mocked(logger.error);

type RepoListMethod = ReturnType<
  typeof createGitHubAdapter
>["listAuthenticatedRepositories"];

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/repos", { headers });
}

function mockRepoList(): ReturnType<typeof vi.fn<RepoListMethod>> {
  const listAuthenticatedRepositories = vi.fn<RepoListMethod>();
  mockCreateGitHubAdapter.mockReturnValue({
    listAuthenticatedRepositories,
  } as unknown as ReturnType<typeof createGitHubAdapter>);
  return listAuthenticatedRepositories;
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
    const listAuthenticatedRepositories = mockRepoList();
    listAuthenticatedRepositories.mockResolvedValue({
      kind: "ok",
      repos: [
        { full_name: "owner/repo-a", id: 111 },
        { full_name: "owner/repo-b", id: 222 },
      ],
      etag: null,
    });

    const req = makeRequest({ Authorization: "Bearer ghp_validtoken" });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repos).toEqual([
      { full_name: "owner/repo-a", id: 111 },
      { full_name: "owner/repo-b", id: 222 },
    ]);
    expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
      token: "ghp_validtoken",
    });
  });

  it("returns 401 when AuthError is thrown by the core adapter", async () => {
    const listAuthenticatedRepositories = mockRepoList();
    listAuthenticatedRepositories.mockRejectedValue(
      new AuthError({ message: "invalid_token" }),
    );

    const req = makeRequest({ Authorization: "Bearer ghp_badtoken" });
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Authentication failed");
  });

  it("passes through GitHubApiError 403", async () => {
    const listAuthenticatedRepositories = mockRepoList();
    listAuthenticatedRepositories.mockRejectedValue(
      new GitHubApiError({ status: 403, message: "rate limit exceeded" }),
    );

    const req = makeRequest({ Authorization: "Bearer ghp_rate_limited" });
    const res = await GET(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Authentication failed");
    expect(body.error).not.toContain("rate limit");
    expect(body.error).not.toContain("ghp_");
    expect(mockLogError).toHaveBeenCalledWith(
      { err: expect.any(GitHubApiError), status: 403 },
      "list_repos failed",
    );
  });

  it("maps NotFoundError through repository copy", async () => {
    const listAuthenticatedRepositories = mockRepoList();
    listAuthenticatedRepositories.mockRejectedValue(
      new NotFoundError({ resource: "repository" }),
    );

    const req = makeRequest({ Authorization: "Bearer ghp_valid" });
    const res = await GET(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("The requested repository could not be found.");
  });

  it("maps other GitHubApiError statuses to generic GitHub 502 copy", async () => {
    const listAuthenticatedRepositories = mockRepoList();
    listAuthenticatedRepositories.mockRejectedValue(
      new GitHubApiError({
        status: 500,
        message: "secret upstream: token ghp_secret leaked",
      }),
    );

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
    const listAuthenticatedRepositories = mockRepoList();
    listAuthenticatedRepositories.mockRejectedValue(new Error("boom"));

    const req = makeRequest({ Authorization: "Bearer ghp_valid" });
    const res = await GET(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("An unexpected error occurred.");
  });

  it("returns empty repos array when user has no repositories", async () => {
    const listAuthenticatedRepositories = mockRepoList();
    listAuthenticatedRepositories.mockResolvedValue({
      kind: "ok",
      repos: [],
      etag: null,
    });

    const req = makeRequest({ Authorization: "Bearer ghp_valid" });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repos).toEqual([]);
  });

  it("forwards If-None-Match to core and returns ETag header on 200", async () => {
    const listAuthenticatedRepositories = mockRepoList();
    listAuthenticatedRepositories.mockResolvedValue({
      kind: "ok",
      repos: [{ full_name: "owner/repo-a", id: 111 }],
      etag: 'W/"v2-abc"',
    });

    const req = makeRequest({
      Authorization: "Bearer ghp_valid",
      "If-None-Match": 'W/"v1-old"',
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe('W/"v2-abc"');
    expect(listAuthenticatedRepositories).toHaveBeenCalledWith({
      ifNoneMatch: 'W/"v1-old"',
    });
  });

  it("returns 304 with ETag and no body when core reports not_modified", async () => {
    const listAuthenticatedRepositories = mockRepoList();
    listAuthenticatedRepositories.mockResolvedValue({
      kind: "not_modified",
      etag: 'W/"v1-old"',
    });

    const req = makeRequest({
      Authorization: "Bearer ghp_valid",
      "If-None-Match": 'W/"v1-old"',
    });
    const res = await GET(req);

    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe('W/"v1-old"');
    expect(res.body).toBeNull();
    expect(mockLogError).not.toHaveBeenCalled();
  });
});
