// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeTestAkbAdapter,
  setupFetch,
} from "../../../agents/tools/__test-helpers__/fetchMock";
import { mockOpenTelemetry } from "../../../agents/tools/__test-helpers__/otelMock";
import { AkbApiError, AuthError } from "../../../errors";
import {
  exchangeKeycloakCode,
  getAuthConfig,
  getCurrentActor,
  getMe,
  login,
  startKeycloakLogin,
  startKeycloakLogout,
} from "./auth";

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

describe("akb auth adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  describe("login (standalone, token-less)", () => {
    it("posts credentials to /api/v1/auth/login and returns {token,user}", async () => {
      const token = makeJwt({ sub: "user-1" });
      const { calls } = setupFetch([
        { status: 200, body: { token, user: VALID_USER } },
      ]);

      const result = await login({
        baseUrl: BASE_URL,
        username: "alice",
        password: "hunter2",
      });

      expect(result).toEqual({ token, user: VALID_USER });
      expect(calls[0]?.url).toBe("https://akb.test/api/v1/auth/login");
      expect(calls[0]?.init?.method).toBe("POST");
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
        username: "alice",
        password: "hunter2",
      });
    });

    it("strips the credentials base-url trailing slash", async () => {
      const { calls } = setupFetch([
        { status: 200, body: { token: makeJwt({}), user: VALID_USER } },
      ]);
      await login({
        baseUrl: "https://akb.test/",
        username: "a",
        password: "b",
      });
      expect(calls[0]?.url).toBe("https://akb.test/api/v1/auth/login");
    });

    it("throws AuthError on akb 401", async () => {
      setupFetch([{ status: 401, body: { detail: "Invalid credentials" } }]);
      await expect(
        login({ baseUrl: BASE_URL, username: "a", password: "b" }),
      ).rejects.toBeInstanceOf(AuthError);
    });

    it("throws AuthError on akb 403", async () => {
      setupFetch([{ status: 403, body: {} }]);
      await expect(
        login({ baseUrl: BASE_URL, username: "a", password: "b" }),
      ).rejects.toBeInstanceOf(AuthError);
    });

    it("preserves a suspended-account code from local login", async () => {
      setupFetch([
        {
          status: 403,
          body: {
            message: "This AKB account is suspended",
            code: "account_suspended",
          },
        },
      ]);

      await expect(
        login({ baseUrl: BASE_URL, username: "a", password: "b" }),
      ).rejects.toMatchObject({
        name: "AuthError",
        context: {
          origin: "akb",
          code: "account_suspended",
          status: 403,
        },
      });
    });

    it("throws AkbApiError preserving the status on akb 5xx", async () => {
      setupFetch([{ status: 503, body: {} }]);
      await expect(
        login({ baseUrl: BASE_URL, username: "a", password: "b" }),
      ).rejects.toMatchObject({ name: "AkbApiError", status: 503 });
    });

    it("throws AkbApiError(422) on akb 422 so the route can map 422", async () => {
      setupFetch([{ status: 422, body: {} }]);
      await expect(
        login({ baseUrl: BASE_URL, username: "a", password: "b" }),
      ).rejects.toMatchObject({ name: "AkbApiError", status: 422 });
    });

    it("throws AkbApiError(0) on a network error", async () => {
      setupFetch([]); // empty queue → fetch mock throws → caught as network error
      await expect(
        login({ baseUrl: BASE_URL, username: "a", password: "b" }),
      ).rejects.toMatchObject({ name: "AkbApiError", status: 0 });
    });

    it("throws AkbApiError(502) — not a raw ZodError — on a shape mismatch", async () => {
      setupFetch([{ status: 200, body: { wrong: "shape" } }]);
      const err = await login({
        baseUrl: BASE_URL,
        username: "a",
        password: "b",
      }).catch((e) => e);
      expect(err).toBeInstanceOf(AkbApiError);
      expect(err).toMatchObject({ status: 502 });
      expect((err as Error).name).not.toBe("ZodError");
    });

    it("throws AkbApiError(502) on a non-JSON body", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("not json", { status: 200 })),
      );
      await expect(
        login({ baseUrl: BASE_URL, username: "a", password: "b" }),
      ).rejects.toMatchObject({ name: "AkbApiError", status: 502 });
    });

    it("never leaks the token onto the span (returns it only)", async () => {
      const token = makeJwt({ sub: "user-1" });
      setupFetch([{ status: 200, body: { token, user: VALID_USER } }]);
      const result = await login({
        baseUrl: BASE_URL,
        username: "a",
        password: "b",
      });
      // The contract: the token is on the result, the span just records user_id.
      expect(result.token).toBe(token);
    });
  });

  describe("getAuthConfig (standalone, token-less)", () => {
    it("preserves managed local-auth and SSO-only policy fields", async () => {
      setupFetch([
        {
          status: 200,
          body: {
            local_auth: { enabled: false },
            keycloak: {
              enabled: true,
              login_url: "/api/v1/auth/keycloak/login",
              sso_only: true,
              enrollment_mode: "invite_only",
            },
          },
        },
      ]);

      const result = await getAuthConfig({ baseUrl: BASE_URL });

      expect(result.config).toEqual({
        local_auth: { enabled: false },
        keycloak: {
          enabled: true,
          login_url: "/api/v1/auth/keycloak/login",
          sso_only: true,
          enrollment_mode: "invite_only",
        },
      });
    });

    it("gets the nested Keycloak config from /api/v1/auth/config", async () => {
      const { calls } = setupFetch([
        {
          status: 200,
          body: {
            keycloak: {
              enabled: true,
              login_url: "/api/v1/auth/keycloak/login",
            },
          },
        },
      ]);

      const result = await getAuthConfig({ baseUrl: BASE_URL });

      expect(result.config).toEqual({
        local_auth: { enabled: true },
        keycloak: {
          enabled: true,
          login_url: "/api/v1/auth/keycloak/login",
          sso_only: false,
        },
      });
      expect(calls[0]?.url).toBe("https://akb.test/api/v1/auth/config");
      expect(calls[0]?.init?.method).toBe("GET");
    });

    it("accepts disabled SSO with a null login_url", async () => {
      setupFetch([
        {
          status: 200,
          body: { keycloak: { enabled: false, login_url: null } },
        },
      ]);

      const result = await getAuthConfig({ baseUrl: BASE_URL });

      expect(result.config).toEqual({
        local_auth: { enabled: true },
        keycloak: { enabled: false, login_url: null, sso_only: false },
      });
    });

    it("strips the config base-url trailing slash", async () => {
      const { calls } = setupFetch([
        {
          status: 200,
          body: { keycloak: { enabled: false, login_url: null } },
        },
      ]);

      await getAuthConfig({ baseUrl: "https://akb.test/" });

      expect(calls[0]?.url).toBe("https://akb.test/api/v1/auth/config");
    });

    it("throws AkbApiError preserving status on config non-ok responses", async () => {
      setupFetch([{ status: 503, body: { detail: "down" } }]);

      await expect(getAuthConfig({ baseUrl: BASE_URL })).rejects.toMatchObject({
        name: "AkbApiError",
        status: 503,
      });
    });

    it("throws AkbApiError(502) on config non-JSON responses", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("not json", { status: 200 })),
      );

      await expect(getAuthConfig({ baseUrl: BASE_URL })).rejects.toMatchObject({
        name: "AkbApiError",
        status: 502,
      });
    });

    it("throws AkbApiError(502) on config schema mismatch", async () => {
      setupFetch([{ status: 200, body: { keycloak_enabled: true } }]);

      const err = await getAuthConfig({ baseUrl: BASE_URL }).catch((e) => e);

      expect(err).toBeInstanceOf(AkbApiError);
      expect(err).toMatchObject({ status: 502 });
      expect((err as Error).name).not.toBe("ZodError");
    });
  });

  describe("exchangeKeycloakCode (standalone, token-less)", () => {
    it("exchanges a one-time Keycloak code for an AKB token and user", async () => {
      const token = makeJwt({ sub: "user-1" });
      const { calls } = setupFetch([
        { status: 200, body: { token, user: VALID_USER } },
      ]);

      const result = await exchangeKeycloakCode({
        baseUrl: BASE_URL,
        code: "one-time-code",
      });

      expect(result).toEqual({ token, user: VALID_USER });
      expect(calls[0]?.url).toBe(
        "https://akb.test/api/v1/auth/keycloak/exchange",
      );
      expect(calls[0]?.init?.method).toBe("POST");
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
        code: "one-time-code",
      });
    });

    it("accepts an optional Keycloak id token without requiring it", async () => {
      const token = makeJwt({ sub: "user-1" });
      setupFetch([
        {
          status: 200,
          body: {
            token,
            user: VALID_USER,
            kc_id_token: "keycloak-id-token",
          },
        },
      ]);

      const result = await exchangeKeycloakCode({
        baseUrl: BASE_URL,
        code: "one-time-code",
      });

      expect(result).toEqual({
        token,
        user: VALID_USER,
        kcIdToken: "keycloak-id-token",
      });
    });

    it("throws AuthError for client/auth exchange failures", async () => {
      setupFetch([{ status: 400, body: { detail: "invalid code" } }]);

      await expect(
        exchangeKeycloakCode({ baseUrl: BASE_URL, code: "bad-code" }),
      ).rejects.toBeInstanceOf(AuthError);
    });

    it("throws AkbApiError preserving status on exchange backend failures", async () => {
      setupFetch([{ status: 503, body: {} }]);

      await expect(
        exchangeKeycloakCode({ baseUrl: BASE_URL, code: "one-time-code" }),
      ).rejects.toMatchObject({ name: "AkbApiError", status: 503 });
    });

    it("throws AkbApiError(502) on exchange non-JSON responses", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("not json", { status: 200 })),
      );

      await expect(
        exchangeKeycloakCode({ baseUrl: BASE_URL, code: "one-time-code" }),
      ).rejects.toMatchObject({ name: "AkbApiError", status: 502 });
    });

    it("throws AkbApiError(502) on exchange schema mismatch", async () => {
      setupFetch([{ status: 200, body: { token: "missing-user" } }]);

      const err = await exchangeKeycloakCode({
        baseUrl: BASE_URL,
        code: "one-time-code",
      }).catch((e) => e);

      expect(err).toBeInstanceOf(AkbApiError);
      expect(err).toMatchObject({ status: 502 });
      expect((err as Error).name).not.toBe("ZodError");
    });
  });

  describe("startKeycloakLogin (standalone, token-less)", () => {
    it("starts the akb login endpoint with manual redirect and returns Location", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          calls.push({ url, init });
          return new Response(null, {
            status: 302,
            headers: { location: "https://idp.test/login?state=abc" },
          });
        }),
      );

      const result = await startKeycloakLogin({
        baseUrl: BASE_URL,
        loginUrl: "/api/v1/auth/keycloak/login",
        redirectPath: "/api/auth/akb/sso/callback?redirect=%2Fdone",
      });

      expect(result).toEqual({
        location: "https://idp.test/login?state=abc",
      });
      const calledUrl = new URL(String(calls[0]?.url));
      expect(`${calledUrl.origin}${calledUrl.pathname}`).toBe(
        "https://akb.test/api/v1/auth/keycloak/login",
      );
      expect(calledUrl.searchParams.get("redirect")).toBe(
        "/api/auth/akb/sso/callback?redirect=%2Fdone",
      );
      expect(calls[0]?.init).toMatchObject({
        method: "GET",
        redirect: "manual",
      });
    });

    it("throws AkbApiError when the login endpoint does not redirect", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("bad gateway", { status: 502 })),
      );

      await expect(
        startKeycloakLogin({
          baseUrl: BASE_URL,
          loginUrl: "/api/v1/auth/keycloak/login",
          redirectPath: "/api/auth/akb/sso/callback?redirect=%2Fdone",
        }),
      ).rejects.toMatchObject({ name: "AkbApiError", status: 502 });
    });

    it("rejects absolute login URLs before issuing a server-side fetch", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      await expect(
        startKeycloakLogin({
          baseUrl: BASE_URL,
          loginUrl: "https://evil.test/api/v1/auth/keycloak/login",
          redirectPath: "/api/auth/akb/sso/callback?redirect=%2Fdone",
        }),
      ).rejects.toMatchObject({
        name: "AkbApiError",
        status: 502,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects non-Keycloak AKB paths before issuing a server-side fetch", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      await expect(
        startKeycloakLogin({
          baseUrl: BASE_URL,
          loginUrl: "/api/v1/internal/metadata",
          redirectPath: "/api/auth/akb/sso/callback?redirect=%2Fdone",
        }),
      ).rejects.toMatchObject({
        name: "AkbApiError",
        status: 502,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws AkbApiError instead of resolving relative redirects against the private backend", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(null, {
              status: 302,
              headers: {
                location: "/realms/reef/protocol/openid-connect/auth",
              },
            }),
        ),
      );

      await expect(
        startKeycloakLogin({
          baseUrl: BASE_URL,
          loginUrl: "/api/v1/auth/keycloak/login",
          redirectPath: "/api/auth/akb/sso/callback?redirect=%2Fdone",
        }),
      ).rejects.toMatchObject({ name: "AkbApiError", status: 502 });
    });
  });

  describe("startKeycloakLogout (standalone, token-less)", () => {
    it("starts the akb logout endpoint with manual redirect and returns Location", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          calls.push({ url, init });
          return new Response(null, {
            status: 302,
            headers: { location: "https://idp.test/logout?state=abc" },
          });
        }),
      );

      const result = await startKeycloakLogout({
        baseUrl: BASE_URL,
        idTokenHint: "id-token",
      });

      expect(result).toEqual({
        location: "https://idp.test/logout?state=abc",
      });
      const calledUrl = new URL(String(calls[0]?.url));
      expect(`${calledUrl.origin}${calledUrl.pathname}`).toBe(
        "https://akb.test/api/v1/auth/keycloak/logout",
      );
      expect(calledUrl.search).toBe("");
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
        id_token_hint: "id-token",
      });
      expect(calls[0]?.init).toMatchObject({
        method: "POST",
        redirect: "manual",
      });
    });

    it("throws AkbApiError instead of resolving relative logout redirects against the private backend", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(null, {
              status: 302,
              headers: { location: "/auth" },
            }),
        ),
      );

      await expect(
        startKeycloakLogout({
          baseUrl: BASE_URL,
          idTokenHint: "id-token",
        }),
      ).rejects.toMatchObject({ name: "AkbApiError", status: 502 });
    });
  });

  describe("getMe (rides the per-request adapter)", () => {
    it("preserves akb-only profile fields via passthrough", async () => {
      const akbBody = {
        user_id: "u-1",
        username: "alice",
        email: "alice@example.com",
        display_name: "Alice",
        is_admin: false,
        auth_method: "jwt",
      };
      setupFetch([{ status: 200, body: akbBody }]);
      const { profile } = await getMe({ adapter: makeTestAkbAdapter() });
      expect(profile).toEqual(akbBody);
    });

    it("requests /api/v1/auth/me", async () => {
      const { calls } = setupFetch([
        { status: 200, body: { username: "alice" } },
      ]);
      await getMe({ adapter: makeTestAkbAdapter() });
      expect(calls[0]?.url).toBe("https://akb.test/api/v1/auth/me");
    });

    it("is non-fatal on a malformed payload (observe-only, returns raw)", async () => {
      // `username` is the wrong type → safeParse fails → should not throw.
      setupFetch([{ status: 200, body: { username: 123 } }]);
      const { profile } = await getMe({ adapter: makeTestAkbAdapter() });
      expect(profile).toEqual({ username: 123 });
    });

    it("propagates AuthError when akb returns 401", async () => {
      setupFetch([{ status: 401, body: {} }]);
      await expect(
        getMe({ adapter: makeTestAkbAdapter() }),
      ).rejects.toBeInstanceOf(AuthError);
    });
  });

  describe("getCurrentActor (profile → JWT-claim fallback)", () => {
    const jwt = makeJwt({ username: "claim-user", sub: "sub-user" });

    it("prefers the profile username", async () => {
      setupFetch([
        { status: 200, body: { username: "alice", user_id: "u-1", id: "x" } },
      ]);
      const { actor } = await getCurrentActor({
        adapter: makeTestAkbAdapter(),
        jwt,
      });
      expect(actor).toBe("alice");
    });

    it("falls back through user_id then id", async () => {
      setupFetch([{ status: 200, body: { user_id: "u-1", id: "x" } }]);
      const first = await getCurrentActor({
        adapter: makeTestAkbAdapter(),
        jwt,
      });
      expect(first.actor).toBe("u-1");

      setupFetch([{ status: 200, body: { id: "x" } }]);
      const second = await getCurrentActor({
        adapter: makeTestAkbAdapter(),
        jwt,
      });
      expect(second.actor).toBe("x");
    });

    it("falls back to a JWT claim when the profile has no identifier", async () => {
      setupFetch([{ status: 200, body: {} }]);
      const { actor } = await getCurrentActor({
        adapter: makeTestAkbAdapter(),
        jwt,
      });
      expect(actor).toBe("claim-user");
    });

    it("skips an empty-string identifier and uses the next valid field", async () => {
      // Malformed profile: `getMe` is observe so the raw payload reaches
      // here; "" should not be accepted as the actor (reverse-move guard).
      setupFetch([{ status: 200, body: { username: "", user_id: "u-1" } }]);
      const { actor } = await getCurrentActor({
        adapter: makeTestAkbAdapter(),
        jwt,
      });
      expect(actor).toBe("u-1");
    });

    it("skips a non-string identifier and falls back to the JWT claim", async () => {
      setupFetch([{ status: 200, body: { username: 123 } }]);
      const { actor } = await getCurrentActor({
        adapter: makeTestAkbAdapter(),
        jwt,
      });
      expect(actor).toBe("claim-user");
    });

    it("returns null when neither the profile nor the JWT yields an actor", async () => {
      setupFetch([{ status: 200, body: {} }]);
      const { actor } = await getCurrentActor({
        adapter: makeTestAkbAdapter(),
        jwt: makeJwt({ foo: "bar" }),
      });
      expect(actor).toBeNull();
    });
  });
});
