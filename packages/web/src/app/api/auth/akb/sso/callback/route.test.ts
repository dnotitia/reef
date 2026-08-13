// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeAuthorization: vi.fn(),
  createSession: vi.fn(),
  invalidate: vi.fn(),
  loggerError: vi.fn(),
  revokeRefreshToken: vi.fn(),
}));

vi.mock("@/server/auth/runtime", () => ({
  getSsoAuthRuntime: vi.fn(async () => ({
    oidc: {
      completeAuthorization: mocks.completeAuthorization,
      revokeRefreshToken: mocks.revokeRefreshToken,
    },
    repository: {},
    sessions: {
      createSession: mocks.createSession,
      invalidate: mocks.invalidate,
    },
  })),
}));

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: mocks.loggerError },
}));

import { GET } from "./route";

const BROWSER_BINDING = Buffer.alloc(32, 1).toString("base64url");
const SESSION_HANDLE = Buffer.alloc(32, 2).toString("base64url");
const EXISTING_HANDLE = Buffer.alloc(32, 3).toString("base64url");
const ACCESS_TOKEN = "access-token-material";
const REFRESH_TOKEN = "refresh-token-material";
const ID_TOKEN = "id-token-material";

function makeRequest(
  options: { query?: string; includeExistingSession?: boolean } = {},
): Request {
  const cookies = [`__reef_sso_start=${BROWSER_BINDING}`];
  if (options.includeExistingSession) {
    cookies.push(`__reef_session=${EXISTING_HANDLE}`);
  }
  return new Request(
    `https://reef.example.com/api/auth/akb/sso/callback?${options.query ?? "code=one-time-code&state=one-time-state"}`,
    { headers: { cookie: cookies.join("; ") } },
  );
}

function completedAuthorization() {
  return {
    providerAlias: "workforce",
    redirectPath: "/workspace/example/issues",
    oidcNonce: "login-nonce",
    tokenSet: {
      accessToken: ACCESS_TOKEN,
      accessTokenExpiresAt: Math.floor(Date.now() / 1_000) + 300,
      refreshToken: REFRESH_TOKEN,
      refreshTokenExpiresAt: Math.floor(Date.now() / 1_000) + 1_800,
      idToken: ID_TOKEN,
    },
  };
}

describe("GET /api/auth/akb/sso/callback", () => {
  beforeEach(() => {
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    mocks.completeAuthorization.mockResolvedValue(completedAuthorization());
    mocks.createSession.mockResolvedValue(SESSION_HANDLE);
    mocks.invalidate.mockResolvedValue(undefined);
    mocks.revokeRefreshToken.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("projects the Keycloak access token through core and returns only an opaque cookie", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ username: "alice", user_id: "user-1" }),
      );

    const response = await GET(makeRequest());

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/login/sso-complete?next=%2Fworkspace%2Fexample%2Fissues",
    );
    expect(await response.text()).toBe("");
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://akb.test/api/v1/auth/me",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        }),
      }),
    );
    expect(fetchSpy.mock.calls.flat().join(" ")).not.toContain(
      "/auth/keycloak/exchange",
    );

    const exposed = [
      response.headers.get("set-cookie"),
      response.headers.get("location"),
      await response.text(),
    ].join(" ");
    expect(exposed).toContain(`__reef_session=${SESSION_HANDLE}`);
    expect(exposed).toContain("HttpOnly");
    for (const token of [ACCESS_TOKEN, REFRESH_TOKEN, ID_TOKEN]) {
      expect(exposed).not.toContain(token);
    }
  });

  it("rejects missing state before token exchange", async () => {
    const response = await GET(makeRequest({ query: "code=one-time-code" }));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/login?sso_error=invalid_sso_state",
    );
    expect(mocks.completeAuthorization).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each([
    [403, "account_suspended", "/login?sso_error=account_suspended"],
    [401, undefined, "/login?sso_error=account_validation_failed"],
  ])(
    "invalidates an existing server session on AKB %s",
    async (status, code, expectedLocation) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        Response.json(
          code
            ? { detail: { message: "Account denied", code } }
            : { detail: "Unauthorized" },
          { status },
        ),
      );

      const response = await GET(makeRequest({ includeExistingSession: true }));

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(expectedLocation);
      expect(response.headers.get("set-cookie")).toContain("__reef_session=");
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(mocks.invalidate).toHaveBeenCalledWith(EXISTING_HANDLE);
      expect(mocks.revokeRefreshToken).toHaveBeenCalledWith(REFRESH_TOKEN);
      expect(mocks.createSession).not.toHaveBeenCalled();
    },
  );

  it("keeps token-shaped unexpected errors out of responses and log arguments", async () => {
    mocks.completeAuthorization.mockRejectedValue(
      new Error(`upstream included ${ACCESS_TOKEN}`),
    );

    const response = await GET(makeRequest());
    const logged = JSON.stringify(mocks.loggerError.mock.calls);

    expect(response.headers.get("location")).toBe(
      "/login?sso_error=sso_failed",
    );
    expect(logged).not.toContain(ACCESS_TOKEN);
    expect(response.headers.get("set-cookie")).not.toContain(ACCESS_TOKEN);
  });

  it("fails closed and revokes the unpersisted refresh token when storage rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ username: "alice", user_id: "user-1" }),
    );
    mocks.createSession.mockRejectedValue(
      new Error(`storage included ${REFRESH_TOKEN}`),
    );

    const response = await GET(makeRequest());

    expect(response.headers.get("location")).toBe(
      "/login?sso_error=session_unavailable",
    );
    expect(mocks.revokeRefreshToken).toHaveBeenCalledWith(REFRESH_TOKEN);
    const exposed = JSON.stringify({
      headers: [...response.headers],
      logs: mocks.loggerError.mock.calls,
    });
    for (const token of [ACCESS_TOKEN, REFRESH_TOKEN, ID_TOKEN]) {
      expect(exposed).not.toContain(token);
    }
  });
});
