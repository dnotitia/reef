import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mockOpenTelemetry } from "../agents/tools/__test-helpers__/otelMock";
import { AuthError, GitHubApiError, NotFoundError } from "../errors";
import { createGitHubAdapter, listLabelsForRepo } from "./github";

mockOpenTelemetry();

const GITHUB_API = "https://api.github.com";

const server = setupServer(
  http.get(`${GITHUB_API}/user/repos`, () =>
    HttpResponse.json(
      [
        { full_name: "owner/repo-a", id: 111 },
        { full_name: "owner/repo-b", id: 222 },
      ],
      { headers: { etag: 'W/"v2-abc"' } },
    ),
  ),
  http.get(`${GITHUB_API}/repos/owner/repo/labels`, () =>
    HttpResponse.json([
      { name: "bug", description: "Something isn't working", color: "d73a4a" },
      { name: "enhancement", description: null, color: "a2eeef" },
    ]),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

describe("GitHubAdapter surface", () => {
  it("exposes reef's monitored-repo read operations, not raw Octokit clients", () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    expect(adapter).toEqual(
      expect.objectContaining({
        listAuthenticatedRepositories: expect.any(Function),
        listRecentActivity: expect.any(Function),
        searchCode: expect.any(Function),
        readFile: expect.any(Function),
        listRepoLabels: expect.any(Function),
      }),
    );
    expect("rest" in adapter).toBe(false);
    expect("graphql" in adapter).toBe(false);
  });
});

// ─── listAuthenticatedRepositories ───────────────────────────────────────────

describe("listAuthenticatedRepositories", () => {
  it("returns authenticated repos as the route-safe wire shape", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

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
    let observedIfNoneMatch: string | null = null;
    server.use(
      http.get(`${GITHUB_API}/user/repos`, ({ request }) => {
        observedIfNoneMatch = request.headers.get("if-none-match");
        return HttpResponse.json([], { headers: { etag: 'W/"v2-new"' } });
      }),
    );
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    await adapter.listAuthenticatedRepositories({ ifNoneMatch: 'W/"v1-old"' });

    expect(observedIfNoneMatch).toBe('W/"v1-old"');
  });

  it("returns not_modified when GitHub responds 304", async () => {
    server.use(
      http.get(
        `${GITHUB_API}/user/repos`,
        () =>
          new HttpResponse(null, {
            status: 304,
            headers: { etag: 'W/"v1-old"' },
          }),
      ),
    );
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    await expect(adapter.listAuthenticatedRepositories()).resolves.toEqual({
      kind: "not_modified",
      etag: 'W/"v1-old"',
    });
  });

  it("maps 401 to AuthError", async () => {
    server.use(
      http.get(`${GITHUB_API}/user/repos`, () =>
        HttpResponse.json({ message: "Bad credentials" }, { status: 401 }),
      ),
    );
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    await expect(
      adapter.listAuthenticatedRepositories(),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("maps 403 to GitHubApiError while preserving the upstream status", async () => {
    server.use(
      http.get(`${GITHUB_API}/user/repos`, () =>
        HttpResponse.json({ message: "rate limit exceeded" }, { status: 403 }),
      ),
    );
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    await expect(adapter.listAuthenticatedRepositories()).rejects.toMatchObject(
      {
        status: 403,
      },
    );
  });

  it("maps 404 to repository NotFoundError", async () => {
    server.use(
      http.get(`${GITHUB_API}/user/repos`, () =>
        HttpResponse.json({ message: "Not Found" }, { status: 404 }),
      ),
    );
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    await expect(
      adapter.listAuthenticatedRepositories(),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("maps other statuses to GitHubApiError without surfacing secret text", async () => {
    server.use(
      http.get(`${GITHUB_API}/user/repos`, () =>
        HttpResponse.json(
          { message: "secret upstream: token ghp_secret leaked" },
          { status: 500 },
        ),
      ),
    );
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    await expect(adapter.listAuthenticatedRepositories()).rejects.toMatchObject(
      {
        status: 500,
        message:
          "An error occurred while communicating with GitHub. Please try again.",
      },
    );
  });
});

// ─── listInstallationRepositories ────────────────────────────────────────────

describe("listInstallationRepositories", () => {
  const INSTALLATION_REPOS = `${GITHUB_API}/installation/repositories`;

  it("unwraps { total_count, repositories } into the route-safe wire shape", async () => {
    server.use(
      http.get(INSTALLATION_REPOS, () =>
        HttpResponse.json(
          {
            total_count: 2,
            repository_selection: "selected",
            repositories: [
              { full_name: "octo/reef", id: 1001 },
              { full_name: "octo/reef-mobile", id: 1002 },
            ],
          },
          { headers: { etag: 'W/"inst-abc"' } },
        ),
      ),
    );
    const adapter = createGitHubAdapter({ token: "ghs_installation" });

    const result = await adapter.listInstallationRepositories();

    expect(result).toEqual({
      kind: "ok",
      repos: [
        { full_name: "octo/reef", id: 1001 },
        { full_name: "octo/reef-mobile", id: 1002 },
      ],
      etag: 'W/"inst-abc"',
    });
  });

  it("forwards If-None-Match to GitHub", async () => {
    let observedIfNoneMatch: string | null = null;
    server.use(
      http.get(INSTALLATION_REPOS, ({ request }) => {
        observedIfNoneMatch = request.headers.get("if-none-match");
        return HttpResponse.json(
          { total_count: 0, repositories: [] },
          { headers: { etag: 'W/"inst-new"' } },
        );
      }),
    );
    const adapter = createGitHubAdapter({ token: "ghs_installation" });

    await adapter.listInstallationRepositories({ ifNoneMatch: 'W/"inst-old"' });

    expect(observedIfNoneMatch).toBe('W/"inst-old"');
  });

  it("returns not_modified when GitHub responds 304", async () => {
    server.use(
      http.get(
        INSTALLATION_REPOS,
        () =>
          new HttpResponse(null, {
            status: 304,
            headers: { etag: 'W/"inst-old"' },
          }),
      ),
    );
    const adapter = createGitHubAdapter({ token: "ghs_installation" });

    await expect(adapter.listInstallationRepositories()).resolves.toEqual({
      kind: "not_modified",
      etag: 'W/"inst-old"',
    });
  });

  it("maps 401 to AuthError", async () => {
    server.use(
      http.get(INSTALLATION_REPOS, () =>
        HttpResponse.json({ message: "Bad credentials" }, { status: 401 }),
      ),
    );
    const adapter = createGitHubAdapter({ token: "ghs_installation" });

    await expect(adapter.listInstallationRepositories()).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("maps other statuses to GitHubApiError without surfacing secret text", async () => {
    server.use(
      http.get(INSTALLATION_REPOS, () =>
        HttpResponse.json(
          { message: "secret upstream: token ghs_secret leaked" },
          { status: 500 },
        ),
      ),
    );
    const adapter = createGitHubAdapter({ token: "ghs_installation" });

    await expect(adapter.listInstallationRepositories()).rejects.toMatchObject({
      status: 500,
      message:
        "An error occurred while communicating with GitHub. Please try again.",
    });
  });
});

// ─── listRecentActivity ──────────────────────────────────────────────────────

describe("listRecentActivity", () => {
  it("returns commit nodes and since-filtered PR nodes through one activity surface", async () => {
    server.use(
      http.post(`${GITHUB_API}/graphql`, async ({ request }) => {
        const body = (await request.json()) as {
          query: string;
          variables: { since?: string | null };
        };
        if (body.query.includes("RecentCommits")) {
          expect(body.variables.since).toBe("2026-04-07T10:00:00Z");
          return HttpResponse.json({
            data: {
              repository: {
                defaultBranchRef: {
                  target: {
                    history: {
                      nodes: [
                        {
                          oid: "abc123",
                          message: "feat: scanned commit",
                          authoredDate: "2026-04-07T09:00:00Z",
                          committedDate: "2026-04-07T10:30:00Z",
                          author: {
                            name: "Alice",
                            user: { login: "alice" },
                          },
                          changedFilesIfAvailable: 2,
                          associatedPullRequests: { nodes: [] },
                        },
                      ],
                    },
                  },
                },
              },
            },
          });
        }
        if (body.query.includes("RecentPullRequests")) {
          return HttpResponse.json({
            data: {
              repository: {
                pullRequests: {
                  nodes: [
                    buildPrNode(7, "Old PR", "2026-04-07T09:30:00Z"),
                    buildPrNode(8, "Fresh PR", "2026-04-07T10:30:00Z"),
                  ],
                },
              },
            },
          });
        }
        return HttpResponse.json({ message: "unknown query" }, { status: 500 });
      }),
    );
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    const result = await adapter.listRecentActivity({
      owner: "owner",
      repo: "repo",
      since: "2026-04-07T10:00:00Z",
    });

    expect(result.commits).toHaveLength(1);
    expect(result.commits[0]?.oid).toBe("abc123");
    expect(result.pullRequests.map((pr) => pr.number)).toEqual([8]);
  });
});

// ─── listLabelsForRepo ────────────────────────────────────────────────────────

describe("listLabelsForRepo", () => {
  it("returns RepoLabel[] on happy path", async () => {
    const adapter = createGitHubAdapter({ token: "ghp_test" });

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
    const allItems = Array.from({ length: 250 }, (_, i) => ({
      name: `label-${i}`,
      description: null,
      color: "ededed",
    }));
    server.use(
      http.get(`${GITHUB_API}/repos/owner/repo/labels`, () =>
        HttpResponse.json(allItems),
      ),
    );
    const adapter = createGitHubAdapter({ token: "ghp_test" });

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
    server.use(
      http.get(`${GITHUB_API}/repos/owner/repo/labels`, () =>
        HttpResponse.json([{ name: "bug", color: "d73a4a" }]),
      ),
    );
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    const result = await listLabelsForRepo({
      adapter,
      owner: "owner",
      repo: "repo",
    });

    expect(result[0].description).toBeNull();
  });

  it("maps 404 → NotFoundError", async () => {
    server.use(
      http.get(`${GITHUB_API}/repos/missing/repo/labels`, () =>
        HttpResponse.json({ message: "Not Found" }, { status: 404 }),
      ),
    );
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    await expect(
      listLabelsForRepo({ adapter, owner: "missing", repo: "repo" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("maps 401 → AuthError", async () => {
    server.use(
      http.get(`${GITHUB_API}/repos/owner/repo/labels`, () =>
        HttpResponse.json({ message: "Bad credentials" }, { status: 401 }),
      ),
    );
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    await expect(
      listLabelsForRepo({ adapter, owner: "owner", repo: "repo" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("maps unknown statuses → GitHubApiError", async () => {
    server.use(
      http.get(`${GITHUB_API}/repos/owner/repo/labels`, () =>
        HttpResponse.json({ message: "Server error" }, { status: 500 }),
      ),
    );
    const adapter = createGitHubAdapter({ token: "ghp_test" });

    await expect(
      listLabelsForRepo({ adapter, owner: "owner", repo: "repo" }),
    ).rejects.toBeInstanceOf(GitHubApiError);
  });
});

function buildPrNode(number: number, title: string, updatedAt: string) {
  return {
    number,
    title,
    body: "",
    headRefName: `feat/${number}`,
    author: { login: "alice" },
    updatedAt,
    createdAt: "2026-04-07T08:00:00Z",
    mergedAt: null,
    commits: {
      nodes: [{ commit: { message: "feat: step" } }],
    },
  };
}
