// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_CONFIG,
  NOT_CONFIGURED,
  resetServerGitHubCredentials,
  setServerAppConfig,
  setServerGitHubPat,
} from "./serverCredentials.testSupport";

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    createGitHubAdapter: vi.fn(),
    createGitHubAppInstallationTokenProvider: vi.fn(),
  };
});

vi.mock("@/lib/api/requestHelpers", () => ({
  getAkbCurrentActor: vi.fn(),
}));

import { getAkbCurrentActor } from "@/lib/api/requestHelpers";
import {
  GitHubApiError,
  createGitHubAdapter,
  createGitHubAppInstallationTokenProvider,
} from "@reef/core";
import { resolveScanGitHubAdapter } from "./resolveScanGitHubAdapter";

const mockGetActor = vi.mocked(getAkbCurrentActor);
const mockCreateGitHubAdapter = vi.mocked(createGitHubAdapter);
const mockCreateProvider = vi.mocked(createGitHubAppInstallationTokenProvider);

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/activity/scan", { headers });
}

const SENTINEL_ADAPTER = {
  adapter: "sentinel",
} as unknown as ReturnType<typeof createGitHubAdapter>;

const SERVER_PAT = "ghp_server_dev_pat";

describe("resolveScanGitHubAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGitHubAdapter.mockReturnValue(SENTINEL_ADAPTER);
    resetServerGitHubCredentials();
  });

  describe("server-managed GitHub App path", () => {
    beforeEach(() => {
      setServerAppConfig(APP_CONFIG);
      mockGetActor.mockResolvedValue({ actor: "alice" });
    });

    it("mints an installation token and returns the adapter without an Authorization header", async () => {
      const mint = vi.fn(async () => "ghs_minted_token");
      mockCreateProvider.mockReturnValue(mint);

      // No Authorization header - the App path should not need browser storage.
      const result = await resolveScanGitHubAdapter(makeRequest());

      expect(result).toEqual({ kind: "adapter", adapter: SENTINEL_ADAPTER });
      expect(mockCreateProvider).toHaveBeenCalledWith({
        config: APP_CONFIG.config,
      });
      expect(mint).toHaveBeenCalledTimes(1);
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: "ghs_minted_token",
      });
    });

    it("validates the session before minting and returns session_invalid when akb rejects it", async () => {
      const mint = vi.fn(async () => "ghs_minted_token");
      mockCreateProvider.mockReturnValue(mint);
      const response = Response.json({ error: "expired" }, { status: 401 });
      mockGetActor.mockResolvedValue({ response });

      const result = await resolveScanGitHubAdapter(makeRequest());

      expect(result).toEqual({ kind: "session_invalid", response });
      expect(mockCreateProvider).not.toHaveBeenCalled();
      expect(mint).not.toHaveBeenCalled();
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });

    it("surfaces a minting failure as github_error without throwing", async () => {
      const error = new GitHubApiError({
        status: 403,
        message: "installation token request failed",
      });
      mockCreateProvider.mockReturnValue(
        vi.fn(async () => {
          throw error;
        }),
      );

      const result = await resolveScanGitHubAdapter(makeRequest());

      expect(result).toEqual({ kind: "github_error", error });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });

    it("ignores an Authorization header when the App is configured", async () => {
      const mint = vi.fn(async () => "ghs_minted_token");
      mockCreateProvider.mockReturnValue(mint);

      const result = await resolveScanGitHubAdapter(
        makeRequest({ Authorization: "Bearer ghp_browser_pat" }),
      );

      expect(result).toEqual({ kind: "adapter", adapter: SENTINEL_ADAPTER });
      // The minted token authenticates the scan, not a browser-supplied value.
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: "ghs_minted_token",
      });
    });
  });

  describe("unconfigured GitHub App path", () => {
    beforeEach(() => {
      setServerAppConfig(NOT_CONFIGURED);
    });

    it("returns github_app_unconfigured without reading an Authorization header", async () => {
      const result = await resolveScanGitHubAdapter(
        makeRequest({ Authorization: "Bearer ghp_user_pat" }),
      );

      expect(result).toEqual({ kind: "github_app_unconfigured" });
      expect(mockGetActor).not.toHaveBeenCalled();
      expect(mockCreateProvider).not.toHaveBeenCalled();
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });

    it("returns github_app_unconfigured when the Authorization header is missing", async () => {
      const result = await resolveScanGitHubAdapter(makeRequest());
      expect(result).toEqual({ kind: "github_app_unconfigured" });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });
  });

  describe("server-managed PAT fallback path (REEF-290)", () => {
    beforeEach(() => {
      setServerAppConfig(NOT_CONFIGURED);
      setServerGitHubPat(SERVER_PAT);
      mockGetActor.mockResolvedValue({ actor: "alice" });
    });

    it("scans with the server PAT without a browser PAT and validates the session", async () => {
      const result = await resolveScanGitHubAdapter(makeRequest());

      expect(result).toEqual({ kind: "adapter", adapter: SENTINEL_ADAPTER });
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: SERVER_PAT,
      });
      // The server PAT is a deployment credential, so the session is validated.
      expect(mockGetActor).toHaveBeenCalledTimes(1);
      expect(mockCreateProvider).not.toHaveBeenCalled();
    });

    it("returns session_invalid when akb rejects the session", async () => {
      const response = Response.json({ error: "expired" }, { status: 401 });
      mockGetActor.mockResolvedValue({ response });

      const result = await resolveScanGitHubAdapter(makeRequest());

      expect(result).toEqual({ kind: "session_invalid", response });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });

    it("prefers the App over the server PAT when both are configured", async () => {
      setServerAppConfig(APP_CONFIG);
      mockCreateProvider.mockReturnValue(vi.fn(async () => "ghs_minted_token"));

      const result = await resolveScanGitHubAdapter(makeRequest());

      expect(result).toEqual({ kind: "adapter", adapter: SENTINEL_ADAPTER });
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: "ghs_minted_token",
      });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalledWith({
        token: SERVER_PAT,
      });
    });
  });
});
