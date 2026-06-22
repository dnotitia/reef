import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    createGitHubAdapter: vi.fn(),
    createGitHubAppInstallationTokenProvider: vi.fn(),
  };
});

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

// Deployment GitHub App config — default "not configured" so the existing PAT
// tests exercise the fallback path; the App-path block flips it to configured.
type ServerAppConfig =
  | {
      ok: true;
      config: { app_id: string; installation_id: string; private_key: string };
      status: { isConfigured: true; appId: string };
    }
  | {
      ok: false;
      status: { isConfigured: false; appId: string | null };
      issues: string[];
    };

const NOT_CONFIGURED: ServerAppConfig = {
  ok: false,
  status: { isConfigured: false, appId: null },
  issues: ["app_id is required"],
};

const appConfigState = vi.hoisted(() => ({
  current: undefined as unknown,
}));

vi.mock("@/lib/github/serverAppConfig", () => ({
  resolveServerGitHubAppConfig: () => appConfigState.current,
}));

import { logger } from "@/lib/logging/logger";
import {
  AuthError,
  GitHubApiError,
  NotFoundError,
  createGitHubAdapter,
  createGitHubAppInstallationTokenProvider,
} from "@reef/core";
import { GET } from "./route";

const mockCreateGitHubAdapter = vi.mocked(createGitHubAdapter);
const mockCreateProvider = vi.mocked(createGitHubAppInstallationTokenProvider);
const mockLogError = vi.mocked(logger.error);

type RepoListMethod = ReturnType<
  typeof createGitHubAdapter
>["listAuthenticatedRepositories"];
type InstallationRepoListMethod = ReturnType<
  typeof createGitHubAdapter
>["listInstallationRepositories"];

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
    appConfigState.current = NOT_CONFIGURED;
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

describe("GET /api/repos — server-managed GitHub App path", () => {
  const APP_CONFIG: ServerAppConfig = {
    ok: true,
    config: {
      app_id: "123456",
      installation_id: "789",
      private_key:
        "-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----",
    },
    status: { isConfigured: true, appId: "123456" },
  };

  function mockInstallationRepoList(token = "ghs_minted_installation_token"): {
    listInstallationRepositories: ReturnType<
      typeof vi.fn<InstallationRepoListMethod>
    >;
    mintInstallationToken: ReturnType<typeof vi.fn<() => Promise<string>>>;
  } {
    const listInstallationRepositories = vi.fn<InstallationRepoListMethod>();
    mockCreateGitHubAdapter.mockReturnValue({
      listInstallationRepositories,
    } as unknown as ReturnType<typeof createGitHubAdapter>);
    const mintInstallationToken = vi.fn<() => Promise<string>>(
      async () => token,
    );
    mockCreateProvider.mockReturnValue(mintInstallationToken);
    return { listInstallationRepositories, mintInstallationToken };
  }

  // A non-expired session cookie (no parseable `exp` reads as not-expired).
  // The App path requires a valid reef session before using the server token.
  function makeAuthedRequest(headers: Record<string, string> = {}): Request {
    return makeRequest({
      Cookie: "__reef_session=test-session-jwt",
      ...headers,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    appConfigState.current = APP_CONFIG;
  });

  it("returns 401 without minting when there is no reef session (REEF-239)", async () => {
    const { listInstallationRepositories, mintInstallationToken } =
      mockInstallationRepoList();

    // App configured, but the caller has no session cookie — the server must
    // not mint a credential or expose the installation's repo list.
    const req = makeRequest();
    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(mintInstallationToken).not.toHaveBeenCalled();
    expect(listInstallationRepositories).not.toHaveBeenCalled();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("lists installation repos with the minted token and no browser PAT (AC1/AC2)", async () => {
    const { listInstallationRepositories, mintInstallationToken } =
      mockInstallationRepoList();
    listInstallationRepositories.mockResolvedValue({
      kind: "ok",
      repos: [{ full_name: "octo/reef", id: 1001 }],
      etag: null,
    });

    // A signed-in workspace user, no browser PAT — the App path serves the list.
    const req = makeAuthedRequest();
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repos).toEqual([{ full_name: "octo/reef", id: 1001 }]);
    // The adapter was built from the minted installation token, not a PAT.
    expect(mintInstallationToken).toHaveBeenCalledTimes(1);
    expect(mockCreateProvider).toHaveBeenCalledWith({
      config: APP_CONFIG.config,
    });
    expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
      token: "ghs_minted_installation_token",
    });
    expect(listInstallationRepositories).toHaveBeenCalledWith({
      ifNoneMatch: null,
    });
  });

  it("ignores a browser PAT header when the App is configured", async () => {
    const { listInstallationRepositories } = mockInstallationRepoList();
    listInstallationRepositories.mockResolvedValue({
      kind: "ok",
      repos: [],
      etag: null,
    });

    const req = makeAuthedRequest({ Authorization: "Bearer ghp_browser_pat" });
    const res = await GET(req);

    expect(res.status).toBe(200);
    // The App token, never the browser PAT, authenticates the read.
    expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
      token: "ghs_minted_installation_token",
    });
    expect(listInstallationRepositories).toHaveBeenCalledTimes(1);
  });

  it("forwards If-None-Match and returns the ETag on the App path", async () => {
    const { listInstallationRepositories } = mockInstallationRepoList();
    listInstallationRepositories.mockResolvedValue({
      kind: "ok",
      repos: [{ full_name: "octo/reef", id: 1001 }],
      etag: 'W/"inst-abc"',
    });

    const req = makeAuthedRequest({ "If-None-Match": 'W/"inst-old"' });
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe('W/"inst-abc"');
    expect(listInstallationRepositories).toHaveBeenCalledWith({
      ifNoneMatch: 'W/"inst-old"',
    });
  });

  it("translates a credential-free GitHubApiError from token minting (AC3)", async () => {
    // The provider mint fails (e.g. installation revoked) — surface PM copy, no
    // secret, and still no browser-PAT requirement.
    mockCreateGitHubAdapter.mockReturnValue({
      listInstallationRepositories: vi.fn(),
    } as unknown as ReturnType<typeof createGitHubAdapter>);
    mockCreateProvider.mockReturnValue(
      vi.fn(async () => {
        throw new GitHubApiError({
          status: 403,
          message: "GitHub App installation token request failed",
        });
      }),
    );

    const req = makeAuthedRequest();
    const res = await GET(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).not.toContain("PRIVATE KEY");
    expect(mockLogError).toHaveBeenCalledWith(
      { err: expect.any(GitHubApiError), status: 403 },
      "list_repos failed",
    );
  });
});
