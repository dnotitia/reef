import {
  APP_CONFIG,
  NOT_CONFIGURED,
  resetServerGitHubCredentials,
  setServerAppConfig,
  setServerGitHubPat,
} from "@/lib/github/serverCredentials.testSupport";
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

vi.mock("@/lib/api/requestHelpers", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/requestHelpers")
  >("@/lib/api/requestHelpers");
  return { ...actual, getAkbCurrentActor: vi.fn() };
});

import { getAkbCurrentActor } from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import {
  GitHubApiError,
  NotFoundError,
  createGitHubAdapter,
  createGitHubAppInstallationTokenProvider,
} from "@reef/core";
import { GET } from "./route";

const mockCreateGitHubAdapter = vi.mocked(createGitHubAdapter);
const mockCreateProvider = vi.mocked(createGitHubAppInstallationTokenProvider);
const mockGetActor = vi.mocked(getAkbCurrentActor);
const mockLogError = vi.mocked(logger.error);

type AuthenticatedRepoListMethod = ReturnType<
  typeof createGitHubAdapter
>["listAuthenticatedRepositories"];
type InstallationRepoListMethod = ReturnType<
  typeof createGitHubAdapter
>["listInstallationRepositories"];

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/repos", { headers });
}

function mockAuthenticatedRepoList(): ReturnType<
  typeof vi.fn<AuthenticatedRepoListMethod>
> {
  const listAuthenticatedRepositories = vi.fn<AuthenticatedRepoListMethod>();
  mockCreateGitHubAdapter.mockReturnValue({
    listAuthenticatedRepositories,
  } as unknown as ReturnType<typeof createGitHubAdapter>);
  return listAuthenticatedRepositories;
}

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
  const mintInstallationToken = vi.fn<() => Promise<string>>(async () => token);
  mockCreateProvider.mockReturnValue(mintInstallationToken);
  return { listInstallationRepositories, mintInstallationToken };
}

describe("GET /api/repos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetServerGitHubCredentials();
  });

  it("returns 503 when no deployment-managed GitHub credential is configured", async () => {
    const res = await GET(makeRequest({ Authorization: "Bearer ghp_ignored" }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "GitHub App is not configured for this deployment.",
    });
    expect(mockGetActor).not.toHaveBeenCalled();
    expect(mockCreateProvider).not.toHaveBeenCalled();
    expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
  });
});

describe("GET /api/repos - server-managed GitHub App path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setServerAppConfig(APP_CONFIG);
    setServerGitHubPat(null);
    mockGetActor.mockResolvedValue({ actor: "alice" });
  });

  it("returns 401 without minting when the akb backend rejects the session (REEF-239)", async () => {
    const { listInstallationRepositories, mintInstallationToken } =
      mockInstallationRepoList();
    mockGetActor.mockResolvedValue({
      response: Response.json(
        { error: "Your session has expired. Please sign in again." },
        { status: 401 },
      ),
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(mintInstallationToken).not.toHaveBeenCalled();
    expect(listInstallationRepositories).not.toHaveBeenCalled();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("lists installation repos with the minted token and no Authorization header (AC1/AC2)", async () => {
    const { listInstallationRepositories, mintInstallationToken } =
      mockInstallationRepoList();
    listInstallationRepositories.mockResolvedValue({
      kind: "ok",
      repos: [{ full_name: "octo/reef", id: 1001 }],
      etag: null,
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      repos: [{ full_name: "octo/reef", id: 1001 }],
    });
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

  it("ignores an Authorization header when the App is configured", async () => {
    const { listInstallationRepositories } = mockInstallationRepoList();
    listInstallationRepositories.mockResolvedValue({
      kind: "ok",
      repos: [],
      etag: null,
    });

    const res = await GET(
      makeRequest({ Authorization: "Bearer ghp_browser_pat" }),
    );

    expect(res.status).toBe(200);
    expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
      token: "ghs_minted_installation_token",
    });
    expect(mockCreateGitHubAdapter).not.toHaveBeenCalledWith({
      token: "ghp_browser_pat",
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

    const res = await GET(makeRequest({ "If-None-Match": 'W/"inst-old"' }));

    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe('W/"inst-abc"');
    expect(listInstallationRepositories).toHaveBeenCalledWith({
      ifNoneMatch: 'W/"inst-old"',
    });
  });

  it("returns 304 with ETag and no body when GitHub reports not_modified", async () => {
    const { listInstallationRepositories } = mockInstallationRepoList();
    listInstallationRepositories.mockResolvedValue({
      kind: "not_modified",
      etag: 'W/"inst-old"',
    });

    const res = await GET(makeRequest({ "If-None-Match": 'W/"inst-old"' }));

    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe('W/"inst-old"');
    expect(res.body).toBeNull();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("maps NotFoundError through repository copy", async () => {
    const { listInstallationRepositories } = mockInstallationRepoList();
    listInstallationRepositories.mockRejectedValue(
      new NotFoundError({ resource: "repository" }),
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "The requested repository could not be found.",
    });
  });

  it("maps other GitHubApiError statuses to generic GitHub 502 copy", async () => {
    const { listInstallationRepositories } = mockInstallationRepoList();
    listInstallationRepositories.mockRejectedValue(
      new GitHubApiError({
        status: 500,
        message: "secret upstream: token ghp_secret leaked",
      }),
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe(
      "An error occurred while communicating with GitHub. Please try again.",
    );
    expect(body.error).not.toContain("(500)");
    expect(body.error).not.toContain("ghp_secret");
  });

  it("translates a credential-free GitHubApiError from token minting (AC3)", async () => {
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

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).not.toContain("PRIVATE KEY");
    expect(mockLogError).toHaveBeenCalledWith(
      { err: expect.any(GitHubApiError), status: 403 },
      "list_repos failed",
    );
  });
});

describe("GET /api/repos - server-managed PAT path (REEF-290)", () => {
  const SERVER_PAT = "ghp_server_dev_pat";

  beforeEach(() => {
    vi.clearAllMocks();
    setServerAppConfig(NOT_CONFIGURED);
    setServerGitHubPat(SERVER_PAT);
    mockGetActor.mockResolvedValue({ actor: "alice" });
  });

  it("lists the authenticated account's repos with the server PAT and no browser PAT", async () => {
    const listAuthenticatedRepositories = mockAuthenticatedRepoList();
    listAuthenticatedRepositories.mockResolvedValue({
      kind: "ok",
      repos: [{ full_name: "octo/reef", id: 1001 }],
      etag: null,
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      repos: [{ full_name: "octo/reef", id: 1001 }],
    });
    expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({ token: SERVER_PAT });
    expect(listAuthenticatedRepositories).toHaveBeenCalledWith({
      ifNoneMatch: null,
    });
    expect(mockGetActor).toHaveBeenCalledTimes(1);
  });

  it("returns the session 401 without listing when akb rejects the session", async () => {
    const listAuthenticatedRepositories = mockAuthenticatedRepoList();
    mockGetActor.mockResolvedValue({
      response: Response.json(
        { error: "Your session has expired. Please sign in again." },
        { status: 401 },
      ),
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(listAuthenticatedRepositories).not.toHaveBeenCalled();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("ignores a browser PAT header when the server PAT is configured", async () => {
    const listAuthenticatedRepositories = mockAuthenticatedRepoList();
    listAuthenticatedRepositories.mockResolvedValue({
      kind: "ok",
      repos: [],
      etag: null,
    });

    const res = await GET(makeRequest({ Authorization: "Bearer ghp_browser" }));

    expect(res.status).toBe(200);
    expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({ token: SERVER_PAT });
    expect(mockCreateGitHubAdapter).not.toHaveBeenCalledWith({
      token: "ghp_browser",
    });
  });
});
