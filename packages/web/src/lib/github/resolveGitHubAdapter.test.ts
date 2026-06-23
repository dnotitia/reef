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

const MINTED_TOKEN = "ghs_minted_token";
const SERVER_PAT = "ghp_server_dev_pat";
const BROWSER_PAT = "ghp_browser_pat";

describe("resolveGitHubAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGitHubAdapter.mockReturnValue(SENTINEL_ADAPTER);
    appConfigState.current = NOT_CONFIGURED;
    serverPatState.current = null;
  });

  describe("server-managed GitHub App tier (highest precedence)", () => {
    beforeEach(() => {
      appConfigState.current = APP_CONFIG;
      mockGetActor.mockResolvedValue({ actor: "alice" });
    });

    it("mints an installation token and tags the source as app", async () => {
      const mint = vi.fn(async () => MINTED_TOKEN);
      mockCreateProvider.mockReturnValue(mint);

      const result = await resolveGitHubAdapter(makeRequest());

      expect(result).toEqual({
        kind: "adapter",
        adapter: SENTINEL_ADAPTER,
        source: "app",
      });
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: MINTED_TOKEN,
      });
    });

    it("wins over a configured server PAT and a browser PAT header (App > serverPat > header)", async () => {
      serverPatState.current = SERVER_PAT;
      const mint = vi.fn(async () => MINTED_TOKEN);
      mockCreateProvider.mockReturnValue(mint);

      const result = await resolveGitHubAdapter(
        makeRequest({ Authorization: `Bearer ${BROWSER_PAT}` }),
      );

      expect(result).toMatchObject({ source: "app" });
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: MINTED_TOKEN,
      });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalledWith({
        token: SERVER_PAT,
      });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalledWith({
        token: BROWSER_PAT,
      });
    });

    it("returns session_invalid without minting when akb rejects the session", async () => {
      const response = Response.json({ error: "expired" }, { status: 401 });
      mockGetActor.mockResolvedValue({ response });
      const mint = vi.fn(async () => MINTED_TOKEN);
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
      appConfigState.current = NOT_CONFIGURED;
      serverPatState.current = SERVER_PAT;
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
        token: SERVER_PAT,
      });
      // It is a deployment credential, so the session is validated first.
      expect(mockGetActor).toHaveBeenCalledTimes(1);
      expect(mockCreateProvider).not.toHaveBeenCalled();
    });

    it("wins over a browser PAT header (serverPat > header)", async () => {
      const result = await resolveGitHubAdapter(
        makeRequest({ Authorization: `Bearer ${BROWSER_PAT}` }),
      );

      expect(result).toMatchObject({ source: "server-pat" });
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: SERVER_PAT,
      });
      expect(mockCreateGitHubAdapter).not.toHaveBeenCalledWith({
        token: BROWSER_PAT,
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

  describe("browser PAT tier (self-authorizing fallback)", () => {
    beforeEach(() => {
      appConfigState.current = NOT_CONFIGURED;
      serverPatState.current = null;
    });

    it("builds the adapter from the Authorization header and never validates the session", async () => {
      const result = await resolveGitHubAdapter(
        makeRequest({ Authorization: `Bearer ${BROWSER_PAT}` }),
      );

      expect(result).toEqual({
        kind: "adapter",
        adapter: SENTINEL_ADAPTER,
        source: "browser-pat",
      });
      expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
        token: BROWSER_PAT,
      });
      // The browser PAT is caller-supplied, so no akb round-trip.
      expect(mockGetActor).not.toHaveBeenCalled();
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
