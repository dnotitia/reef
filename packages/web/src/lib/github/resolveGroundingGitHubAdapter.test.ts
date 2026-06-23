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
const serverPatState = vi.hoisted(() => ({ current: null as string | null }));

vi.mock("@/lib/github/serverAppConfig", () => ({
  resolveServerGitHubAppConfig: () => appConfigState.current,
}));
vi.mock("@/lib/github/serverPat", () => ({
  resolveServerGitHubPat: () => serverPatState.current,
}));

import { getAkbCurrentActor } from "@/lib/api/requestHelpers";
import {
  GitHubApiError,
  createGitHubAdapter,
  createGitHubAppInstallationTokenProvider,
} from "@reef/core";
import { resolveGroundingGitHubAdapter } from "./resolveGroundingGitHubAdapter";

const mockGetActor = vi.mocked(getAkbCurrentActor);
const mockCreateGitHubAdapter = vi.mocked(createGitHubAdapter);
const mockCreateProvider = vi.mocked(createGitHubAppInstallationTokenProvider);

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/chat", { headers });
}

const SENTINEL_ADAPTER = {
  adapter: "sentinel",
} as unknown as ReturnType<typeof createGitHubAdapter>;

const MINTED_TOKEN = "ghs_minted_token";

const SERVER_PAT = "ghp_server_dev_pat";

describe("resolveGroundingGitHubAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGitHubAdapter.mockReturnValue(SENTINEL_ADAPTER);
    serverPatState.current = null;
  });

  describe("server-managed GitHub App path", () => {
    beforeEach(() => {
      appConfigState.current = APP_CONFIG;
      mockGetActor.mockResolvedValue({ actor: "alice" });
    });

    it("mints an installation token and returns the adapter without a browser PAT", async () => {
      const mint = vi.fn(async () => MINTED_TOKEN);
      mockCreateProvider.mockReturnValue(mint);

      // No Authorization header — grounding must not need a browser PAT (AC1).
      const result = await resolveGroundingGitHubAdapter(makeRequest());

      expect(result).toEqual({ kind: "adapter", adapter: SENTINEL_ADAPTER });
      expect(mockCreateProvider).toHaveBeenCalledWith({
        config: APP_CONFIG.config,
      });
      expect(mint).toHaveBeenCalledTimes(1);
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: MINTED_TOKEN,
      });
    });

    it("ignores a browser PAT header when the App is configured", async () => {
      const mint = vi.fn(async () => MINTED_TOKEN);
      mockCreateProvider.mockReturnValue(mint);

      const result = await resolveGroundingGitHubAdapter(
        makeRequest({ Authorization: "Bearer ghp_browser_pat" }),
      );

      expect(result).toEqual({ kind: "adapter", adapter: SENTINEL_ADAPTER });
      // The minted token grounds the request, never the browser PAT.
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: MINTED_TOKEN,
      });
    });

    it("degrades without minting when akb rejects the session", async () => {
      const mint = vi.fn(async () => MINTED_TOKEN);
      mockCreateProvider.mockReturnValue(mint);
      mockGetActor.mockResolvedValue({
        response: Response.json({ error: "expired" }, { status: 401 }),
      });

      const result = await resolveGroundingGitHubAdapter(makeRequest());

      // Grounding degrades to AKB-only rather than 401 (the route's own akb
      // reads still enforce the session), and the credential is never minted.
      expect(result).toEqual({
        kind: "degraded",
        reason: "session_unverified",
      });
      expect(mockCreateProvider).not.toHaveBeenCalled();
      expect(mint).not.toHaveBeenCalled();
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });

    it("degrades to AKB-only when minting the installation token fails (AC3)", async () => {
      const error = new GitHubApiError({
        status: 403,
        message: "installation token request failed",
      });
      mockCreateProvider.mockReturnValue(
        vi.fn(async () => {
          throw error;
        }),
      );

      const result = await resolveGroundingGitHubAdapter(makeRequest());

      expect(result).toEqual({
        kind: "degraded",
        reason: "github_app_error",
        error,
      });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });

    it("never exposes the minted token on the degraded result (AC4)", async () => {
      const error = new GitHubApiError({
        status: 403,
        message: "installation token request failed",
      });
      mockCreateProvider.mockReturnValue(
        vi.fn(async () => {
          throw error;
        }),
      );

      const result = await resolveGroundingGitHubAdapter(makeRequest());

      expect(JSON.stringify(result)).not.toContain(MINTED_TOKEN);
    });
  });

  describe("browser PAT fallback path", () => {
    beforeEach(() => {
      appConfigState.current = NOT_CONFIGURED;
    });

    it("builds the adapter from the Authorization header and never validates the session", async () => {
      const result = await resolveGroundingGitHubAdapter(
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

    it("degrades to AKB-only when the Authorization header is missing (AC1/AC3)", async () => {
      const result = await resolveGroundingGitHubAdapter(makeRequest());
      expect(result).toEqual({ kind: "degraded", reason: "no_credential" });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });

    it("degrades to AKB-only when the Authorization header is malformed", async () => {
      const result = await resolveGroundingGitHubAdapter(
        makeRequest({ Authorization: "Token abc123" }),
      );
      expect(result).toEqual({ kind: "degraded", reason: "no_credential" });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });
  });

  describe("server-managed PAT fallback path (REEF-290)", () => {
    beforeEach(() => {
      appConfigState.current = NOT_CONFIGURED;
      serverPatState.current = SERVER_PAT;
      mockGetActor.mockResolvedValue({ actor: "alice" });
    });

    it("grounds with the server PAT without a browser PAT and validates the session", async () => {
      const result = await resolveGroundingGitHubAdapter(makeRequest());

      expect(result).toEqual({ kind: "adapter", adapter: SENTINEL_ADAPTER });
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: SERVER_PAT,
      });
      // The server PAT is a deployment credential, so the session is validated.
      expect(mockGetActor).toHaveBeenCalledTimes(1);
      expect(mockCreateProvider).not.toHaveBeenCalled();
    });

    it("degrades to AKB-only when akb rejects the session", async () => {
      mockGetActor.mockResolvedValue({
        response: Response.json({ error: "expired" }, { status: 401 }),
      });

      const result = await resolveGroundingGitHubAdapter(makeRequest());

      expect(result).toEqual({
        kind: "degraded",
        reason: "session_unverified",
      });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalled();
    });

    it("prefers the App over the server PAT when both are configured", async () => {
      appConfigState.current = APP_CONFIG;
      mockCreateProvider.mockReturnValue(vi.fn(async () => MINTED_TOKEN));

      const result = await resolveGroundingGitHubAdapter(makeRequest());

      expect(result).toEqual({ kind: "adapter", adapter: SENTINEL_ADAPTER });
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: MINTED_TOKEN,
      });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalledWith({
        token: SERVER_PAT,
      });
    });
  });
});
