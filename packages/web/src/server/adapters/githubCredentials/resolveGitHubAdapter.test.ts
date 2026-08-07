// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_CONFIG,
  NOT_CONFIGURED,
  resetServerGitHubCredentials,
  setServerAppConfig,
  setServerGitHubPat,
} from "./serverCredentials.testSupport";

vi.mock("@/server/adapters/githubAdapter", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/adapters/githubAdapter")
  >("@/server/adapters/githubAdapter");
  return {
    ...actual,
    createGitHubAdapter: vi.fn(),
  };
});

vi.mock("@/server/adapters/github/appAuth", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/adapters/github/appAuth")
  >("@/server/adapters/github/appAuth");
  return {
    ...actual,
    createGitHubAppInstallationTokenProvider: vi.fn(),
  };
});

vi.mock("@/lib/api/requestHelpers", () => ({
  getAkbCurrentActor: vi.fn(),
}));

import { getAkbCurrentActor } from "@/lib/api/requestHelpers";
import { createGitHubAppInstallationTokenProvider } from "@/server/adapters/github/appAuth";
import { createGitHubAdapter } from "@/server/adapters/githubAdapter";
import { GitHubApiError } from "@reef/core";
import { resolveGitHubAdapter } from "./resolveGitHubAdapter";

const mockGetActor = vi.mocked(getAkbCurrentActor);
const mockCreateGitHubAdapter = vi.mocked(createGitHubAdapter);
const mockCreateProvider = vi.mocked(createGitHubAppInstallationTokenProvider);

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/repos", { headers });
}

const SENTINEL_ADAPTER = {
  adapter: "sentinel",
} as unknown as ReturnType<typeof createGitHubAdapter>;

const appValue = "test";
const serverValue = "server";

describe("resolveGitHubAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGitHubAdapter.mockReturnValue(SENTINEL_ADAPTER);
    resetServerGitHubCredentials();
  });

  describe("server-managed GitHub App tier (highest precedence)", () => {
    beforeEach(() => {
      setServerAppConfig(APP_CONFIG);
      mockGetActor.mockResolvedValue({ actor: "alice" });
    });

    it("mints an installation token and tags the source as app", async () => {
      const mint = vi.fn(async () => appValue);
      mockCreateProvider.mockReturnValue(mint);

      const result = await resolveGitHubAdapter(makeRequest());

      expect(result).toEqual({
        kind: "adapter",
        adapter: SENTINEL_ADAPTER,
        source: "app",
      });
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: appValue,
      });
    });

    it("wins over a configured server PAT and ignores a browser PAT header", async () => {
      setServerGitHubPat(serverValue);
      const mint = vi.fn(async () => appValue);
      mockCreateProvider.mockReturnValue(mint);

      const result = await resolveGitHubAdapter(
        makeRequest({ Authorization: "Bearer browser" }),
      );

      expect(result).toMatchObject({ source: "app" });
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: appValue,
      });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalledWith({
        token: serverValue,
      });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalledWith({
        token: "browser",
      });
    });

    it("returns session_invalid without minting when akb rejects the session", async () => {
      const response = Response.json({ error: "expired" }, { status: 401 });
      mockGetActor.mockResolvedValue({ response });
      const mint = vi.fn(async () => appValue);
      mockCreateProvider.mockReturnValue(mint);

      const result = await resolveGitHubAdapter(makeRequest());

      expect(result).toEqual({ kind: "session_invalid", response });
      expect(mint).not.toHaveBeenCalled();
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });

    it("returns github_app_error when minting fails", async () => {
      const error = new GitHubApiError({
        status: 403,
        message: "installation token request failed",
      });
      mockCreateProvider.mockReturnValue(
        vi.fn(async () => {
          throw error;
        }),
      );

      const result = await resolveGitHubAdapter(makeRequest());

      expect(result).toEqual({ kind: "github_app_error", error });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });
  });

  describe("server-managed PAT tier (dev/CI fallback)", () => {
    beforeEach(() => {
      setServerAppConfig(NOT_CONFIGURED);
      setServerGitHubPat(serverValue);
      mockGetActor.mockResolvedValue({ actor: "alice" });
    });

    it("uses the server PAT without a browser header and tags the source as server-pat", async () => {
      const result = await resolveGitHubAdapter(makeRequest());

      expect(result).toEqual({
        kind: "adapter",
        adapter: SENTINEL_ADAPTER,
        source: "server-pat",
      });
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: serverValue,
      });
      // It is a deployment credential, so the session is validated first.
      expect(mockGetActor).toHaveBeenCalledTimes(1);
      expect(mockCreateProvider).not.toHaveBeenCalled();
    });

    it("ignores a browser PAT header when the server PAT is configured", async () => {
      const result = await resolveGitHubAdapter(
        makeRequest({ Authorization: "Bearer browser" }),
      );

      expect(result).toMatchObject({ source: "server-pat" });
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: serverValue,
      });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalledWith({
        token: "browser",
      });
    });

    it("returns session_invalid without using the PAT when akb rejects the session", async () => {
      const response = Response.json({ error: "expired" }, { status: 401 });
      mockGetActor.mockResolvedValue({ response });

      const result = await resolveGitHubAdapter(makeRequest());

      expect(result).toEqual({ kind: "session_invalid", response });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });
  });

  describe("no deployment credential", () => {
    beforeEach(() => {
      resetServerGitHubCredentials();
    });

    it("returns no_credential even when an Authorization header is present", async () => {
      const result = await resolveGitHubAdapter(
        makeRequest({ Authorization: "Bearer browser" }),
      );

      expect(result).toEqual({ kind: "no_credential" });
      expect(mockGetActor).not.toHaveBeenCalled();
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });

    it("returns no_credential when the Authorization header is missing", async () => {
      const result = await resolveGitHubAdapter(makeRequest());

      expect(result).toEqual({ kind: "no_credential" });
      expect(mockGetActor).not.toHaveBeenCalled();
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });

    it("returns no_credential when the Authorization header is malformed", async () => {
      const result = await resolveGitHubAdapter(
        makeRequest({ Authorization: "Token abc123" }),
      );

      expect(result).toEqual({ kind: "no_credential" });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });
  });
});
