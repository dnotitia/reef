// @vitest-environment node
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

vi.mock("@/lib/api/requestHelpers", () => ({
  getAkbCurrentActor: vi.fn(),
}));

// Deployment GitHub App config — flip per test via appConfigState.
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

const appConfigState = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("@/lib/github/serverAppConfig", () => ({
  resolveServerGitHubAppConfig: () => appConfigState.current,
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

describe("resolveScanGitHubAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGitHubAdapter.mockReturnValue(SENTINEL_ADAPTER);
  });

  describe("server-managed GitHub App path", () => {
    beforeEach(() => {
      appConfigState.current = APP_CONFIG;
      mockGetActor.mockResolvedValue({ actor: "alice" });
    });

    it("mints an installation token and returns the adapter without a browser PAT", async () => {
      const mint = vi.fn(async () => "ghs_minted_token");
      mockCreateProvider.mockReturnValue(mint);

      // No Authorization header — the App path must not need a browser PAT.
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

    it("ignores a browser PAT header when the App is configured", async () => {
      const mint = vi.fn(async () => "ghs_minted_token");
      mockCreateProvider.mockReturnValue(mint);

      const result = await resolveScanGitHubAdapter(
        makeRequest({ Authorization: "Bearer ghp_browser_pat" }),
      );

      expect(result).toEqual({ kind: "adapter", adapter: SENTINEL_ADAPTER });
      // The minted token authenticates the scan, never the browser PAT.
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: "ghs_minted_token",
      });
    });
  });

  describe("browser PAT fallback path", () => {
    beforeEach(() => {
      appConfigState.current = NOT_CONFIGURED;
    });

    it("builds the adapter from the Authorization header and never validates the session", async () => {
      const result = await resolveScanGitHubAdapter(
        makeRequest({ Authorization: "Bearer ghp_user_pat" }),
      );

      expect(result).toEqual({ kind: "adapter", adapter: SENTINEL_ADAPTER });
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: "ghp_user_pat",
      });
      // The PAT path is self-authorizing — no akb /auth/me round-trip.
      expect(mockGetActor).not.toHaveBeenCalled();
      expect(mockCreateProvider).not.toHaveBeenCalled();
    });

    it("returns github_auth_required when the Authorization header is missing", async () => {
      const result = await resolveScanGitHubAdapter(makeRequest());
      expect(result).toEqual({ kind: "github_auth_required" });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });

    it("returns github_auth_required when the Authorization header is malformed", async () => {
      const result = await resolveScanGitHubAdapter(
        makeRequest({ Authorization: "Token abc123" }),
      );
      expect(result).toEqual({ kind: "github_auth_required" });
    });
  });
});
