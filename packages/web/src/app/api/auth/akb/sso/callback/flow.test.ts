import { createHash, generateKeyPairSync } from "node:crypto";
import { createLocalJWKSet, exportJWK, jwtVerify, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCompanionAccountValidator } from "@/server/auth-v2/companionLogin";
import { createAuthV2LoginStateStore } from "@/server/auth-v2/loginStateStore";
import { createAuthV2OidcProtocol } from "@/server/auth-v2/oidcProtocol";
import { createAuthV2SessionCipher } from "@/server/auth-v2/sessionCipher";
import {
  createAuthV2SessionStore,
  type AuthV2SessionBackend,
} from "@/server/auth-v2/sessionStore";
import type { AuthV2EnabledRuntimeConfig } from "@/server/auth-v2/config";
import type {
  AuthV2RouteRuntime,
  AuthV2SsoContract,
} from "@/server/auth-v2/runtime";
import { AUTH_V2_SESSION_COOKIE } from "@/server/auth-v2/cookie";

const ref = vi.hoisted(() => ({
  runtime: undefined as AuthV2RouteRuntime | undefined,
}));
vi.mock("@/server/auth-v2/runtime", () => ({
  AuthV2RouteRuntimeError: class extends Error {},
  getAuthV2RouteRuntime: async () => ref.runtime,
}));
import { GET as start } from "../start/route";
import { GET as callback } from "./route";

const idpKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const bffKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const issuer = "https://keycloak.test/realms/akb";
const akbOrigin = "https://akb.test";
const now = () => Math.floor(Date.now() / 1000);

function memoryBackend(): AuthV2SessionBackend {
  const values = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  return {
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async del(key) {
      values.delete(key);
      sets.delete(key);
    },
    async consume(key) {
      const value = values.get(key) ?? null;
      values.delete(key);
      return value;
    },
    async replace(key, previous, value) {
      if (values.get(key) !== previous) return false;
      values.set(key, value);
      return true;
    },
    async addToSet(key, value) {
      const set = sets.get(key) ?? new Set<string>();
      set.add(value);
      sets.set(key, set);
    },
    async removeFromSet(key, value) {
      sets.get(key)?.delete(value);
    },
    async members(key) {
      return [...(sets.get(key) ?? [])];
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  ref.runtime = undefined;
});

async function fixture(denial?: string) {
  const config: AuthV2EnabledRuntimeConfig = {
    enabled: true,
    mode: "sso",
    issuer,
    transportUrl: issuer,
    clientId: "reef-web",
    audience: `${akbOrigin}/api`,
    publicOrigin: "https://reef.test",
    redisUrl: "redis://localhost:6379",
    encryptionKey: new Uint8Array(32).fill(7),
    sessionNamespace: "flow",
  };
  const contract: AuthV2SsoContract = {
    schema_version: 2,
    auth_mode: "sso",
    local_auth: { enabled: false },
    keycloak: { enabled: true, browser_session_ready: true },
    mcp_oauth: { enabled: false },
    providers: [
      {
        alias: "entra",
        display_name: "Teams",
        provider_type: "oidc",
        login_url: "/api/v1/auth/sso/entra/login",
      },
    ],
  };
  const jwk = await exportJWK(idpKeys.publicKey);
  const jwks = createLocalJWKSet({
    keys: [{ ...jwk, kid: "idp-1", alg: "RS256", use: "sig" }],
  });
  const backend = memoryBackend();
  const cipher = createAuthV2SessionCipher(config.encryptionKey);
  const stateStore = createAuthV2LoginStateStore({ backend, cipher, now });
  const store = createAuthV2SessionStore({ backend, cipher, now });
  const protocol = createAuthV2OidcProtocol({
    runtime: config,
    contract,
    providerAlias: "entra",
    jwks,
    now,
    fetch: (...args) => fetch(...args),
  });
  const audience = `${akbOrigin}/api/v1/auth/sso/companion/complete`;
  const accountValidator = createCompanionAccountValidator({
    clientId: config.clientId,
    baseUrl: () => akbOrigin,
    env: {
      NODE_ENV: "test",
      REEF_AKB_LOGIN_AUDIENCE: audience,
      REEF_AKB_LOGIN_KEY_ID: "reef-1",
      REEF_AKB_LOGIN_PRIVATE_KEY: bffKeys.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    },
  });
  ref.runtime = {
    config,
    contract,
    stateStore,
    store,
    protocolFor: () => protocol,
    accountValidator,
    now,
    close: async () => undefined,
    refreshLock: { acquire: async () => null, release: async () => undefined },
  };
  const response = await start(
    new Request(
      "https://reef.test/api/auth/akb/sso/start?provider=entra&redirect=%2Fworkspace%2Freef",
    ),
  );
  const authorization = new URL(response.headers.get("location") ?? "");
  expect(authorization.origin).toBe("https://keycloak.test");
  expect(authorization.searchParams.get("redirect_uri")).toBe(
    "https://reef.test/api/auth/akb/sso/callback",
  );
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  const state = authorization.searchParams.get("state") ?? "";
  const nonce = authorization.searchParams.get("nonce");
  const time = now();
  const access = await new SignJWT({
    sub: "teams-subject",
    azp: config.clientId,
    typ: "Bearer",
    jti: "access-1",
    sid: "sid-1",
    identity_provider: "entra",
    scope: "openid profile email",
    email: "alice@corp.example",
    email_verified: true,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "idp-1" })
    .setIssuer(issuer)
    .setAudience(config.audience)
    .setIssuedAt(time)
    .setExpirationTime(time + 300)
    .sign(idpKeys.privateKey);
  const id = await new SignJWT({
    sub: "teams-subject",
    azp: config.clientId,
    sid: "sid-1",
    identity_provider: "entra",
    nonce,
    auth_time: time,
    at_hash: createHash("sha256")
      .update(access)
      .digest()
      .subarray(0, 16)
      .toString("base64url"),
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "idp-1" })
    .setIssuer(issuer)
    .setAudience(config.clientId)
    .setIssuedAt(time)
    .setExpirationTime(time + 300)
    .sign(idpKeys.privateKey);
  const calls: string[] = [];
  let bound = false;
  const user = { id: "existing-local-user", username: "alice" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push(url);
      if (url.endsWith("/token")) {
        const body = new URLSearchParams(String(init.body));
        expect(body.get("code")).toBe("single-code");
        expect(
          createHash("sha256")
            .update(body.get("code_verifier") ?? "")
            .digest("base64url"),
        ).toBe(authorization.searchParams.get("code_challenge"));
        return Response.json({
          access_token: access,
          id_token: id,
          refresh_token: "refresh-secret",
          token_type: "Bearer",
          expires_in: 300,
          refresh_expires_in: 3600,
        });
      }
      expect(new Headers(init.headers).get("authorization")).toBe(
        `Bearer ${access}`,
      );
      if (url === audience) {
        const headers = new Headers(init.headers);
        const { payload } = await jwtVerify(
          headers.get("x-akb-login-assertion") ?? "",
          bffKeys.publicKey,
          { issuer: config.clientId, audience },
        );
        const body = JSON.parse(String(init.body));
        expect(payload.request_hash).toBe(
          createHash("sha256")
            .update(
              JSON.stringify([body.provider_alias, body.nonce, access, id]),
            )
            .digest("base64url"),
        );
        expect(headers.get("x-akb-id-token")).toBe(id);
        if (denial)
          return Response.json(
            { code: denial, detail: { code: denial, message: "denied" } },
            { status: 403 },
          );
        bound = true;
        return Response.json({ user });
      }
      expect(url).toBe(`${akbOrigin}/api/v1/auth/me`);
      expect(bound).toBe(true);
      return Response.json(user);
    }),
  );
  return { state, cookie, calls, store, access };
}

describe("Reef callback to AKB companion completion integration", () => {
  it("finishes the original local account login without an AKB browser redirect", async () => {
    const f = await fixture();
    const request = () =>
      new Request(
        `https://reef.test/api/auth/akb/sso/callback?code=single-code&state=${f.state}`,
        { headers: { cookie: f.cookie } },
      );
    const response = await callback(request());
    expect(response.headers.get("location")).toBe("/workspace/reef");
    const cookies = response.headers.getSetCookie();
    const handle =
      cookies
        .find(
          (value) =>
            value.startsWith(`${AUTH_V2_SESSION_COOKIE}=`) &&
            !value.includes("Max-Age=0"),
        )
        ?.split(";")[0]
        ?.split("=")[1] ?? "";
    expect(handle).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect((await f.store.resolve(handle))?.access_token).toBe(f.access);
    expect(cookies.join()).not.toContain(f.access);
    expect(f.calls).toEqual([
      `${issuer}/protocol/openid-connect/token`,
      `${akbOrigin}/api/v1/auth/sso/companion/complete`,
      `${akbOrigin}/api/v1/auth/me`,
    ]);
    const replay = await callback(request());
    expect(replay.headers.get("location")).toContain("sso_error=");
    expect(f.calls).toHaveLength(3);
  });
  it.each(["membership_required", "account_suspended", "identity_conflict"])(
    "does not issue a session for %s",
    async (denial) => {
      const f = await fixture(denial);
      const response = await callback(
        new Request(
          `https://reef.test/api/auth/akb/sso/callback?code=single-code&state=${f.state}`,
          { headers: { cookie: f.cookie } },
        ),
      );
      expect(response.headers.get("location")).toBe(
        `/login?sso_error=${denial}&redirect=%2Fworkspace%2Freef`,
      );
      expect(response.headers.get("x-reef-auth-invalidated")).toBe("1");
      expect(
        response.headers
          .getSetCookie()
          .filter((value) => value.startsWith(`${AUTH_V2_SESSION_COOKIE}=`))
          .every((value) => value.includes("Max-Age=0")),
      ).toBe(true);
      expect(f.calls).toHaveLength(2);
    },
  );
  it("refuses another browser before exchanging the code or contacting AKB", async () => {
    const f = await fixture();
    const response = await callback(
      new Request(
        `https://reef.test/api/auth/akb/sso/callback?code=single-code&state=${f.state}`,
        { headers: { cookie: `__reef_auth_v2_state=entra.${"X".repeat(43)}` } },
      ),
    );
    expect(response.headers.get("location")).toContain("sso_error=");
    expect(f.calls).toHaveLength(0);
  });
});
