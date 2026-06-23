// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockScanAndPersistActivitySuggestions,
  mockCreateGitHubAdapter,
  mockCreateProvider,
} = vi.hoisted(() => ({
  mockScanAndPersistActivitySuggestions: vi.fn(),
  mockCreateGitHubAdapter: vi.fn(),
  mockCreateProvider: vi.fn(),
}));

vi.mock("@reef/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@reef/core")>();
  return {
    ...original,
    scanAndPersistActivitySuggestions: mockScanAndPersistActivitySuggestions,
    createGitHubAdapter: mockCreateGitHubAdapter,
    createGitHubAppInstallationTokenProvider: mockCreateProvider,
  };
});

// Deployment GitHub App config - default configured in tests so activity scan
// exercises the REEF-244 server-managed credential path.
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

// The App path validates the reef session against akb before minting; mock that
// boundary so route tests stay hermetic. getAkbAdapter stays real so the
// session-cookie checks below still exercise the cookie decode.
vi.mock("@/lib/api/requestHelpers", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/requestHelpers")
  >("@/lib/api/requestHelpers");
  return { ...actual, getAkbCurrentActor: vi.fn() };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { getAkbCurrentActor } from "@/lib/api/requestHelpers";
import { AkbApiError, AuthError, GitHubApiError } from "@reef/core";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { POST } from "./route";

const mockGetActor = vi.mocked(getAkbCurrentActor);

const VALID_BODY = {
  owner: "octo",
  repo: "cat",
  vault: "reef-octocat",
  since: "2026-05-08T08:00:00.000Z",
  projectPrefix: "REEF",
};

const VALID_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
};

function makeRequest(opts: {
  body?: unknown;
  headers?: Record<string, string>;
}): Request {
  return new Request("http://localhost/api/activity/scan", {
    method: "POST",
    body: JSON.stringify(opts.body ?? VALID_BODY),
    headers: opts.headers ?? VALID_HEADERS,
  });
}

describe("POST /api/activity/scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
    vi.stubEnv("OPENROUTER_BASE_URL", "https://api.openai.com/v1");
    vi.stubEnv("REEF_LLM_MODEL", "gpt-4o");
    appConfigState.current = APP_CONFIG;
    mockGetActor.mockResolvedValue({ actor: "alice" });
    mockCreateGitHubAdapter.mockReturnValue({});
    mockCreateProvider.mockReturnValue(vi.fn(async () => "ghs_minted_token"));
    mockScanAndPersistActivitySuggestions.mockResolvedValue({
      status: "completed",
      drafts: [],
      statusChanges: [],
      persistedSuggestions: [],
      addedDrafts: 0,
      addedStatusChanges: 0,
      scannedAt: "2026-05-08T10:00:00.000Z",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 200 with added suggestion counts on happy path", async () => {
    mockScanAndPersistActivitySuggestions.mockResolvedValueOnce({
      status: "completed",
      drafts: [],
      statusChanges: [],
      persistedSuggestions: [],
      addedDrafts: 1,
      addedStatusChanges: 1,
      scannedAt: "2026-05-08T10:00:00.000Z",
    });

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      addedDrafts: 1,
      addedStatusChanges: 1,
      scannedAt: "2026-05-08T10:00:00.000Z",
    });
    expect(mockScanAndPersistActivitySuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "octo",
        repo: "cat",
        vault: "reef-octocat",
        since: "2026-05-08T08:00:00.000Z",
        projectPrefix: "REEF",
        akbAdapter: expect.anything(),
      }),
    );
  });

  it("returns 400 on invalid JSON body", async () => {
    const req = new Request("http://localhost/api/activity/scan", {
      method: "POST",
      body: "not json",
      headers: VALID_HEADERS,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 on schema validation failure", async () => {
    const res = await POST(makeRequest({ body: { owner: "" } }));
    expect(res.status).toBe(400);
  });

  it("returns 401 when the session cookie is missing", async () => {
    const res = await POST(
      makeRequest({
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 503 when the GitHub App is not configured", async () => {
    appConfigState.current = NOT_CONFIGURED;

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "GitHub App is not configured for this deployment.",
    });
    expect(mockCreateProvider).not.toHaveBeenCalled();
    expect(mockScanAndPersistActivitySuggestions).not.toHaveBeenCalled();
  });

  it("returns 503 when deployment OpenRouter config is missing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const res = await POST(
      makeRequest({
        headers: {
          "Content-Type": "application/json",
          cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
        },
      }),
    );
    expect(res.status).toBe(503);
  });

  it("returns 500 with a generic message for an unexpected error (no raw leak)", async () => {
    mockScanAndPersistActivitySuggestions.mockRejectedValueOnce(
      new Error("LLM 429"),
    );
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(500);
    // translateError hides the raw technical message behind PM vocabulary.
    expect(await res.json()).toEqual({
      error: "An unexpected error occurred.",
    });
  });

  it("maps a typed AkbApiError to its HTTP status instead of a flat 500", async () => {
    mockScanAndPersistActivitySuggestions.mockRejectedValueOnce(
      new AkbApiError({ status: 404, message: "vault gone" }),
    );
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(404);
  });

  it("maps a typed AuthError to 401", async () => {
    mockScanAndPersistActivitySuggestions.mockRejectedValueOnce(
      new AuthError({ message: "bad" }),
    );
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/activity/scan — server-managed GitHub App path", () => {
  // A signed-in workspace session; no Authorization header is needed.
  function makeAppRequest(headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/activity/scan", {
      method: "POST",
      body: JSON.stringify(VALID_BODY),
      headers: {
        "Content-Type": "application/json",
        cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
        ...headers,
      },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
    vi.stubEnv("OPENROUTER_BASE_URL", "https://api.openai.com/v1");
    vi.stubEnv("REEF_LLM_MODEL", "gpt-4o");
    appConfigState.current = APP_CONFIG;
    mockGetActor.mockResolvedValue({ actor: "alice" });
    mockCreateGitHubAdapter.mockReturnValue({});
    mockScanAndPersistActivitySuggestions.mockResolvedValue({
      status: "completed",
      drafts: [],
      statusChanges: [],
      persistedSuggestions: [],
      addedDrafts: 0,
      addedStatusChanges: 0,
      scannedAt: "2026-05-08T10:00:00.000Z",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("scans with a minted installation token and no Authorization header (AC1/AC2)", async () => {
    const mint = vi.fn(async () => "ghs_minted_token");
    mockCreateProvider.mockReturnValue(mint);

    const res = await POST(makeAppRequest());

    expect(res.status).toBe(200);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(mockCreateProvider).toHaveBeenCalledWith({
      config: APP_CONFIG.config,
    });
    // The scan adapter is built from the minted token.
    expect(mockCreateGitHubAdapter).toHaveBeenCalledWith({
      token: "ghs_minted_token",
    });
    expect(mockScanAndPersistActivitySuggestions).toHaveBeenCalledTimes(1);
  });

  it("returns 401 without minting when the akb backend rejects the session (AC1)", async () => {
    const mint = vi.fn(async () => "ghs_minted_token");
    mockCreateProvider.mockReturnValue(mint);
    mockGetActor.mockResolvedValue({
      response: Response.json(
        { error: "Your session has expired. Please sign in again." },
        { status: 401 },
      ),
    });

    const res = await POST(makeAppRequest());

    expect(res.status).toBe(401);
    expect(mint).not.toHaveBeenCalled();
    expect(mockScanAndPersistActivitySuggestions).not.toHaveBeenCalled();
  });

  it("maps a credential-free GitHubApiError from token minting (AC4)", async () => {
    mockCreateProvider.mockReturnValue(
      vi.fn(async () => {
        throw new GitHubApiError({
          status: 403,
          message: "GitHub App installation token request failed",
        });
      }),
    );

    const res = await POST(makeAppRequest());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).not.toContain("PRIVATE KEY");
    expect(mockScanAndPersistActivitySuggestions).not.toHaveBeenCalled();
  });
});
