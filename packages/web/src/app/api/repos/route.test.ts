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

const appConfigState = vi.hoisted(() => ({
  current: undefined as unknown,
}));

vi.mock("@/lib/github/serverAppConfig", () => ({
  resolveServerGitHubAppConfig: () => appConfigState.current,
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

type InstallationRepoListMethod = ReturnType<
  typeof createGitHubAdapter
>["listInstallationRepositories"];

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/repos", { headers });
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
    appConfigState.current = NOT_CONFIGURED;
  });

  it("returns 503 when the GitHub App is not configured", async () => {
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
    appConfigState.current = APP_CONFIG;
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
