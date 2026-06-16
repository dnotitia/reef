import { Octokit } from "@octokit/rest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockOpenTelemetry } from "../agents/tools/__test-helpers__/otelMock";
import { AuthError, GitHubApiError, NotFoundError } from "../errors";
import { createGitHubAdapter, listLabelsForRepo } from "./github";

mockOpenTelemetry();

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

// ─── listAuthenticatedRepositories ───────────────────────────────────────────

describe("listAuthenticatedRepositories", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns authenticated repos as the route-safe wire shape", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    vi.spyOn(
      adapter.rest.repos,
      "listForAuthenticatedUser",
    ).mockResolvedValueOnce({
      data: [
        { full_name: "owner/repo-a", id: 111 },
        { full_name: "owner/repo-b", id: 222 },
      ],
      headers: { etag: 'W/"v2-abc"' },
    } as never);

    const result = await adapter.listAuthenticatedRepositories();

    expect(result).toEqual({
      kind: "ok",
      repos: [
        { full_name: "owner/repo-a", id: 111 },
        { full_name: "owner/repo-b", id: 222 },
      ],
      etag: 'W/"v2-abc"',
    });
  });

  it("forwards If-None-Match to GitHub", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });
    const listForAuthenticatedUser = vi
      .spyOn(adapter.rest.repos, "listForAuthenticatedUser")
      .mockResolvedValueOnce({
        data: [],
        headers: {},
      } as never);

    await adapter.listAuthenticatedRepositories({ ifNoneMatch: 'W/"v1-old"' });

    expect(listForAuthenticatedUser).toHaveBeenCalledWith(
      expect.objectContaining({
        per_page: 100,
        sort: "updated",
        headers: { "if-none-match": 'W/"v1-old"' },
      }),
    );
  });

  it("returns not_modified when Octokit throws a 304 RequestError", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    vi.spyOn(
      adapter.rest.repos,
      "listForAuthenticatedUser",
    ).mockRejectedValueOnce(
      octokitHttpError(304, "Not modified", { etag: 'W/"v1-old"' }),
    );

    await expect(adapter.listAuthenticatedRepositories()).resolves.toEqual({
      kind: "not_modified",
      etag: 'W/"v1-old"',
    });
  });

  it("maps 401 to AuthError", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    vi.spyOn(
      adapter.rest.repos,
      "listForAuthenticatedUser",
    ).mockRejectedValueOnce(octokitHttpError(401, "Bad credentials"));

    await expect(
      adapter.listAuthenticatedRepositories(),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("maps 403 to GitHubApiError while preserving the upstream status", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    vi.spyOn(
      adapter.rest.repos,
      "listForAuthenticatedUser",
    ).mockRejectedValueOnce(octokitHttpError(403, "rate limit exceeded"));

    await expect(adapter.listAuthenticatedRepositories()).rejects.toMatchObject(
      {
        status: 403,
      },
    );
  });

  it("maps 404 to repository NotFoundError", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    vi.spyOn(
      adapter.rest.repos,
      "listForAuthenticatedUser",
    ).mockRejectedValueOnce(octokitHttpError(404, "Not Found"));

    await expect(
      adapter.listAuthenticatedRepositories(),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("maps other statuses to GitHubApiError without surfacing secret text", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    vi.spyOn(
      adapter.rest.repos,
      "listForAuthenticatedUser",
    ).mockRejectedValueOnce(
      octokitHttpError(500, "secret upstream: token ghp_secret leaked"),
    );

    await expect(adapter.listAuthenticatedRepositories()).rejects.toMatchObject(
      {
        status: 500,
        message:
          "An error occurred while communicating with GitHub. Please try again.",
      },
    );
  });
});

// ─── listLabelsForRepo ────────────────────────────────────────────────────────

describe("listLabelsForRepo", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns RepoLabel[] on happy path", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    vi.spyOn(adapter.rest, "paginate").mockResolvedValueOnce([
      { name: "bug", description: "Something isn't working", color: "d73a4a" },
      { name: "enhancement", description: null, color: "a2eeef" },
    ] as never);

    const result = await listLabelsForRepo({
      adapter,
      owner: "owner",
      repo: "repo",
    });

    expect(result).toEqual([
      { name: "bug", description: "Something isn't working", color: "d73a4a" },
      { name: "enhancement", description: null, color: "a2eeef" },
    ]);
  });

  it("caps the result at MAX_REPO_LABELS (200)", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    const allItems = Array.from({ length: 250 }, (_, i) => ({
      name: `label-${i}`,
      description: null,
      color: "ededed",
    }));
    vi.spyOn(adapter.rest, "paginate").mockResolvedValueOnce(allItems as never);

    const result = await listLabelsForRepo({
      adapter,
      owner: "owner",
      repo: "repo",
    });

    expect(result).toHaveLength(200);
    expect(result[0].name).toBe("label-0");
    expect(result[199].name).toBe("label-199");
  });

  it("normalizes undefined description to null", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    vi.spyOn(adapter.rest, "paginate").mockResolvedValueOnce([
      { name: "bug", color: "d73a4a" },
    ] as never);

    const result = await listLabelsForRepo({
      adapter,
      owner: "owner",
      repo: "repo",
    });

    expect(result[0].description).toBeNull();
  });

  it("maps 404 → NotFoundError", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    vi.spyOn(adapter.rest, "paginate").mockRejectedValueOnce({
      status: 404,
      message: "Not Found",
    });

    await expect(
      listLabelsForRepo({ adapter, owner: "missing", repo: "repo" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("maps 401 → AuthError", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    vi.spyOn(adapter.rest, "paginate").mockRejectedValueOnce({
      status: 401,
      message: "Bad credentials",
    });

    await expect(
      listLabelsForRepo({ adapter, owner: "owner", repo: "repo" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("maps unknown statuses → GitHubApiError", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    vi.spyOn(adapter.rest, "paginate").mockRejectedValueOnce({
      status: 500,
      message: "Server error",
    });

    await expect(
      listLabelsForRepo({ adapter, owner: "owner", repo: "repo" }),
    ).rejects.toBeInstanceOf(GitHubApiError);
  });
});
