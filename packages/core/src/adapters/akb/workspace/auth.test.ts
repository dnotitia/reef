// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { AkbApiError, AuthError } from "../../../errors";
import {
  makeTestAkbAdapter,
  setupFetch,
} from "../../../test-support/akb/fetchMock";
import { mockOpenTelemetry } from "../../../test-support/akb/otelMock";
import { getAuthConfig, getCurrentActor, getMe, login } from "./auth";

mockOpenTelemetry();

const BASE_URL = "https://akb.test";

function makeJwt(payload: object): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

const VALID_USER = {
  id: "user-1",
  username: "alice",
  email: "alice@example.com",
  display_name: "Alice",
  is_admin: false,
};

const SSO_CONFIG = {
  schema_version: 2,
  auth_mode: "sso",
  local_auth: { enabled: false },
  keycloak: { enabled: true, browser_session_ready: true },
  providers: [
    {
      provider_type: "keycloak-oidc",
      alias: "workforce",
      display_name: "Company SSO",
      login_url: "/api/v1/auth/sso/workforce/login",
    },
    {
      provider_type: "local-realm",
      alias: "local-realm",
      display_name: "Local realm",
      login_url: null,
    },
  ],
  mcp_oauth: { enabled: false },
} as const;

describe("akb auth adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts local credentials to the current login endpoint", async () => {
    const token = makeJwt({ sub: "user-1" });
    const { calls } = setupFetch([
      { status: 200, body: { token, user: VALID_USER } },
    ]);

    await expect(
      login({ baseUrl: BASE_URL, username: "alice", password: "hunter2" }),
    ).resolves.toEqual({ token, user: VALID_USER });
    expect(calls[0]?.url).toBe("https://akb.test/api/v1/auth/login");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      username: "alice",
      password: "hunter2",
    });
  });

  it("maps local authentication failures to AuthError", async () => {
    setupFetch([{ status: 401, body: { detail: "Invalid credentials" } }]);
    await expect(
      login({ baseUrl: BASE_URL, username: "a", password: "b" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("preserves non-auth backend status", async () => {
    setupFetch([{ status: 503, body: {} }]);
    await expect(
      login({ baseUrl: BASE_URL, username: "a", password: "b" }),
    ).rejects.toMatchObject({ name: "AkbApiError", status: 503 });
  });

  it("accepts the current v2 capability catalog and provider types", async () => {
    const { calls } = setupFetch([{ status: 200, body: SSO_CONFIG }]);
    await expect(getAuthConfig({ baseUrl: BASE_URL })).resolves.toEqual({
      config: SSO_CONFIG,
    });
    expect(calls[0]?.url).toBe("https://akb.test/api/v1/auth/config");
  });

  it("accepts brokered OIDC alongside a local-realm provider", async () => {
    const config = {
      ...SSO_CONFIG,
      providers: [
        {
          provider_type: "oidc",
          alias: "entra",
          display_name: "teams",
          login_url: "/api/v1/auth/sso/entra/login",
        },
        SSO_CONFIG.providers[1],
      ],
    } as const;
    setupFetch([{ status: 200, body: config }]);

    await expect(getAuthConfig({ baseUrl: BASE_URL })).resolves.toEqual({
      config,
    });
  });

  it("rejects provider types outside the v2 catalog", async () => {
    setupFetch([
      {
        status: 200,
        body: {
          ...SSO_CONFIG,
          providers: [
            {
              ...SSO_CONFIG.providers[0],
              provider_type: "saml",
            },
          ],
        },
      },
    ]);

    await expect(getAuthConfig({ baseUrl: BASE_URL })).rejects.toMatchObject({
      name: "AkbApiError",
      status: 502,
    });
  });

  it("rejects the retired unversioned capability shape without fallback", async () => {
    setupFetch([
      {
        status: 200,
        body: {
          local_auth: { enabled: true },
          keycloak: { enabled: true, login_url: "/api/v1/auth/keycloak/login" },
        },
      },
    ]);
    await expect(getAuthConfig({ baseUrl: BASE_URL })).rejects.toMatchObject({
      name: "AkbApiError",
      status: 502,
    });
  });

  it("rejects duplicate provider aliases", async () => {
    setupFetch([
      {
        status: 200,
        body: {
          ...SSO_CONFIG,
          providers: [SSO_CONFIG.providers[0], SSO_CONFIG.providers[0]],
        },
      },
    ]);
    await expect(getAuthConfig({ baseUrl: BASE_URL })).rejects.toMatchObject({
      name: "AkbApiError",
      status: 502,
    });
  });

  it("preserves the complete me profile", async () => {
    const profile = {
      user_id: "u-1",
      username: "alice",
      auth_method: "oauth",
      account_kind: "human",
    };
    setupFetch([{ status: 200, body: profile }]);
    await expect(getMe({ adapter: makeTestAkbAdapter() })).resolves.toEqual({
      profile,
    });
  });

  it("resolves the canonical actor from me before any fallback claim", async () => {
    setupFetch([{ status: 200, body: { user_id: "u-1", username: "alice" } }]);
    await expect(
      getCurrentActor({
        adapter: makeTestAkbAdapter(),
        jwt: makeJwt({ username: "wrong" }),
      }),
    ).resolves.toEqual({ actor: "alice" });
  });

  it("falls back to the supplied local credential claim when me omits identifiers", async () => {
    setupFetch([{ status: 200, body: {} }]);
    await expect(
      getCurrentActor({
        adapter: makeTestAkbAdapter(),
        jwt: makeJwt({ username: "alice" }),
      }),
    ).resolves.toEqual({ actor: "alice" });
  });

  it("keeps malformed me payloads non-fatal to the adapter boundary", async () => {
    setupFetch([{ status: 200, body: { username: 123 } }]);
    await expect(getMe({ adapter: makeTestAkbAdapter() })).resolves.toEqual({
      profile: { username: 123 },
    });
  });

  it("returns a bounded adapter error for malformed login JSON", async () => {
    setupFetch([{ status: 200, body: { wrong: true } }]);
    await expect(
      login({ baseUrl: BASE_URL, username: "a", password: "b" }),
    ).rejects.toMatchObject({ name: "AkbApiError", status: 502 });
  });
});
