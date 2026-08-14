// @vitest-environment node

import { AkbApiError, AuthError } from "@reef/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRuntime: vi.fn(),
  invalidate: vi.fn(),
  resolveAccessToken: vi.fn(),
}));

vi.mock("@/server/auth/runtime", () => ({
  getSsoAuthRuntime: mocks.getRuntime,
}));

import { getAkbAdapter, getAkbCurrentActor } from "./requestHelpers";

const OPAQUE_HANDLE = Buffer.alloc(32, 8).toString("base64url");
const ACCESS_TOKEN = "current-keycloak-access-token";

function requestWithSession(): Request {
  return new Request("https://reef.example.com/api/issues", {
    headers: { cookie: `__reef_session=${OPAQUE_HANDLE}` },
  });
}

describe("getAkbAdapter in SSO mode", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("REEF_AUTH_MODE", "sso");
    vi.stubEnv(
      "REEF_KEYCLOAK_ISSUER",
      "https://identity.example.com/realms/reef",
    );
    vi.stubEnv("REEF_KEYCLOAK_CLIENT_ID", "reef-web");
    vi.stubEnv("REEF_AKB_API_AUDIENCE", "akb-api");
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.example.com");
    vi.stubEnv("AKB_BACKEND_URL", "https://akb.example.com");
    mocks.resolveAccessToken.mockResolvedValue(ACCESS_TOKEN);
    mocks.invalidate.mockResolvedValue(undefined);
    mocks.getRuntime.mockResolvedValue({
      sessions: {
        invalidate: mocks.invalidate,
        resolveAccessToken: mocks.resolveAccessToken,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    [401, undefined],
    [403, "account_suspended"],
  ])(
    "forwards the access token and invalidates the server session on AKB %s",
    async (status, code) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          Response.json(
            code
              ? { detail: { message: "account denied", code } }
              : { detail: "unauthorized" },
            { status },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);
      const result = getAkbAdapter(requestWithSession());
      if (!("adapter" in result)) throw new Error("expected SSO adapter");

      const rejection = result.adapter.request("/api/v1/issues");

      await expect(rejection).rejects.toBeInstanceOf(AuthError);
      expect(mocks.resolveAccessToken).toHaveBeenCalledWith(OPAQUE_HANDLE);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://akb.example.com/api/v1/issues",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${ACCESS_TOKEN}`,
          }),
        }),
      );
      expect(mocks.invalidate).toHaveBeenCalledWith(OPAQUE_HANDLE);
    },
  );

  it("bounds runtime/store startup failures without exposing connection details", async () => {
    mocks.getRuntime.mockRejectedValueOnce(
      new Error("redis://session-user:session-password@redis.example.com:6379"),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = getAkbAdapter(requestWithSession());
    if (!("adapter" in result)) throw new Error("expected SSO adapter");

    const error = await result.adapter
      .request("/api/v1/issues")
      .catch((reason) => reason);

    expect(error).toBeInstanceOf(AkbApiError);
    expect(error).toMatchObject({
      status: 503,
      context: { message: "sso_session_upstream_unavailable" },
    });
    expect(JSON.stringify(error)).not.toContain("session-password");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps an actor lookup store outage to a backend failure, not a 401", async () => {
    mocks.getRuntime.mockRejectedValueOnce(new Error("redis unavailable"));

    const result = await getAkbCurrentActor(requestWithSession());

    expect(result).toHaveProperty("response");
    if (!("response" in result)) throw new Error("expected error response");
    expect(result.response.status).toBe(502);
    expect(result.response.headers.get("x-reef-auth-invalidated")).toBeNull();
  });

  it("uses AKB as actor authority and resolves the SSO token only once", async () => {
    const keycloakAccessToken = [
      "header",
      Buffer.from(
        JSON.stringify({ preferred_username: "keycloak-display-name" }),
      ).toString("base64url"),
      "signature",
    ].join(".");
    mocks.resolveAccessToken.mockResolvedValue(keycloakAccessToken);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));

    const result = await getAkbCurrentActor(requestWithSession());

    expect(result).toHaveProperty("response");
    if (!("response" in result)) throw new Error("expected error response");
    expect(result.response.status).toBe(502);
    expect(mocks.resolveAccessToken).toHaveBeenCalledOnce();
  });
});
