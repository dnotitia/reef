// @vitest-environment node

import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AkbAuthV2Config, AkbUser } from "@reef/core";
import {
  readAuthV2RuntimeConfig,
  type AuthV2EnabledRuntimeConfig,
} from "@/server/auth-v2/config";
import {
  AUTH_V2_SESSION_COOKIE,
  AUTH_V2_STATE_COOKIE,
  parseAuthV2StateCookie,
} from "@/server/auth-v2/cookie";
import { parseCookieHeader } from "@/lib/akb/sessionCookie";
import {
  createAuthV2LoginStateStore,
  loginKey,
} from "@/server/auth-v2/loginStateStore";
import { createAuthV2OidcProtocol } from "@/server/auth-v2/oidcProtocol";
import type { AuthV2RouteRuntime } from "@/server/auth-v2/runtime";
import { createAuthV2SessionCipher } from "@/server/auth-v2/sessionCipher";
import { createAuthV2SessionStore } from "@/server/auth-v2/sessionStore";
import type { AuthV2SessionBackend } from "@/server/auth-v2/sessionStore";
import type { AccountValidationResult } from "@/server/auth-v2/oidcValidator";

const runtimeRef = vi.hoisted(() => ({
  current: undefined as AuthV2RouteRuntime | undefined,
}));

vi.mock("@/server/auth-v2/runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/auth-v2/runtime")
  >("@/server/auth-v2/runtime");
  return {
    ...actual,
    getAuthV2RouteRuntime: vi.fn(async () => {
      if (!runtimeRef.current) throw new Error("fixture runtime missing");
      return runtimeRef.current;
    }),
  };
});

import { GET as start } from "./start/route";
import { GET as callback } from "./callback/route";
import { GET as session } from "./session/route";
import { POST as refresh } from "./refresh/route";
import { POST as logout } from "./logout/route";

const NOW = 2_000_000_000;
const ISSUER = "https://identity.example.com/realms/reef";
const TRANSPORT = "http://keycloak.identity.svc.cluster.local:8080/realms/reef";
const USER: AkbUser = {
  id: "akb-user-1",
  username: "alice",
  email: "alice@example.com",
  display_name: "Alice",
  is_admin: false,
};

class MemoryBackend implements AuthV2SessionBackend {
  readonly values = new Map<string, string>();
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async del(key: string) {
    this.values.delete(key);
  }
  async consume(key: string) {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }
  async replace(key: string, expected: string, value: string) {
    if (this.values.get(key) !== expected) return false;
    this.values.set(key, value);
    return true;
  }
}

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { modulusLength: 2048 });
  privateKey = pair.privateKey;
  jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: "fixture-key" }],
  });
});

function contract(): Extract<AkbAuthV2Config, { auth_mode: "sso" }> {
  return {
    schema_version: 2,
    auth_mode: "sso",
    local_auth: { enabled: true },
    canonical_issuer: ISSUER,
    accepted_audiences: ["akb-api", "other-deployment-api"],
    accepted_clients: ["reef-web", "other-deployment-client"],
    token_validation: {
      algorithms: ["RS256"],
      access_token_type: "Bearer",
      provider_claim: "identity_provider",
    },
    account_validation: {
      endpoint: "/api/v2/auth/account-validation",
      credential: "bearer_access_token",
      requires_subject_binding: true,
      denial_codes: [
        "membership_required",
        "account_suspended",
        "identity_conflict",
      ],
    },
    keycloak: { enabled: true, browser_session_ready: true },
    providers: [
      {
        provider_type: "keycloak-oidc",
        alias: "workforce",
        display_name: "Company SSO",
      },
    ],
  };
}

function runtimeConfig(): AuthV2EnabledRuntimeConfig {
  const config = readAuthV2RuntimeConfig({
    NODE_ENV: "test",
    REEF_AUTH_V2_ENABLED: "1",
    REEF_KEYCLOAK_ISSUER: ISSUER,
    REEF_KEYCLOAK_TRANSPORT_URL: TRANSPORT,
    REEF_KEYCLOAK_CLIENT_ID: "reef-web",
    REEF_AKB_API_AUDIENCE: "akb-api",
    REEF_PUBLIC_ORIGIN: "http://localhost:3000",
  });
  if (!config.enabled) throw new Error("expected auth-v2 runtime");
  return config;
}

function makeRequest(path: string, cookie?: string): Request {
  const headers = cookie ? { cookie } : undefined;
  return new Request(`http://localhost${path}`, { headers });
}

async function signTokens(nonce: string, expiresAt: number) {
  const accessToken = await new SignJWT({
    iss: ISSUER,
    aud: "akb-api",
    sub: "kc-subject-1",
    azp: "reef-web",
    identity_provider: "workforce",
    typ: "Bearer",
    iat: NOW,
    exp: expiresAt,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "fixture-key" })
    .sign(privateKey);
  const idToken = await new SignJWT({
    iss: ISSUER,
    aud: "reef-web",
    azp: "reef-web",
    sub: "kc-subject-1",
    nonce,
    iat: NOW,
    exp: expiresAt,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "fixture-key" })
    .sign(privateKey);
  return {
    access_token: accessToken,
    refresh_token: "fixture-refresh-token",
    id_token: idToken,
    token_type: "Bearer",
    expires_in: Math.max(1, expiresAt - NOW),
    refresh_expires_in: 3_600,
  };
}

describe("auth-v2 Route Handler contract flow", () => {
  let backend: MemoryBackend;
  let cipher: ReturnType<typeof createAuthV2SessionCipher>;
  let runtime: AuthV2RouteRuntime;
  let nowSeconds: number;
  let tokenResponseCount: number;
  let accountDenial: string | null;
  let currentNonce: string;

  beforeEach(() => {
    backend = new MemoryBackend();
    cipher = createAuthV2SessionCipher(new Uint8Array(32).fill(8));
    nowSeconds = NOW;
    tokenResponseCount = 0;
    accountDenial = null;
    currentNonce = "";

    const stateStore = createAuthV2LoginStateStore({
      backend,
      cipher,
      now: () => nowSeconds,
    });
    const store = createAuthV2SessionStore({
      backend,
      cipher,
      now: () => nowSeconds,
    });
    const config = runtimeConfig();
    const authProtocol = createAuthV2OidcProtocol({
      runtime: config,
      contract: contract(),
      providerAlias: "workforce",
      jwks,
      now: () => nowSeconds,
      fetch: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/token")) {
          tokenResponseCount += 1;
          const params = new URLSearchParams(String(init?.body ?? ""));
          const response = await signTokens(
            currentNonce,
            params.get("grant_type") === "refresh_token"
              ? nowSeconds + 600
              : NOW + 1,
          );
          return new Response(JSON.stringify(response), { status: 200 });
        }
        if (url.endsWith("/revoke")) return new Response(null, { status: 200 });
        throw new Error("unexpected fixture Keycloak request");
      },
    });

    let lockOwner: string | null = null;
    runtime = {
      config,
      contract: contract(),
      store,
      stateStore,
      refreshLock: {
        async acquire() {
          if (lockOwner) return null;
          lockOwner = "fixture-owner";
          return lockOwner;
        },
        async release() {
          lockOwner = null;
        },
      },
      now: () => nowSeconds,
      protocolFor: () => authProtocol,
      accountValidator: async (
        input,
      ): Promise<AccountValidationResult<AkbUser>> => {
        expect(input.subject).toBe("kc-subject-1");
        expect(input.providerAlias).toBe("workforce");
        expect(input.accessToken).not.toContain("fixture-code");
        if (accountDenial) {
          return {
            outcome: "denied",
            code: accountDenial as "membership_required",
          };
        }
        return { outcome: "accepted", account: USER };
      },
      close: async () => undefined,
    };
    runtimeRef.current = runtime;
  });

  it("runs start → callback → encrypted session → check → refresh → logout", async () => {
    const started = await start(
      makeRequest(
        "/api/auth/v2/start?provider=workforce&redirect=/workspace/reef/issues",
      ),
    );
    expect(started.status).toBe(302);
    const startLocation = new URL(String(started.headers.get("location")));
    const stateCookie = parseCookieHeader(started.headers.get("set-cookie"))[
      AUTH_V2_STATE_COOKIE
    ];
    const parsedCookie = parseAuthV2StateCookie(stateCookie);
    expect(parsedCookie?.providerAlias).toBe("workforce");
    expect(startLocation.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(startLocation.toString()).not.toContain("access_token");
    const encryptedState = backend.values.get(
      loginKey(startLocation.searchParams.get("state") ?? ""),
    );
    if (!encryptedState || !parsedCookie)
      throw new Error("missing fixture state");
    currentNonce = JSON.parse(
      cipher.decrypt(
        encryptedState,
        loginKey(startLocation.searchParams.get("state") ?? ""),
      ),
    ).nonce as string;

    const callbackResponse = await callback(
      makeRequest(
        `/api/auth/v2/callback?code=fixture-code&state=${encodeURIComponent(
          startLocation.searchParams.get("state") ?? "",
        )}`,
        `${AUTH_V2_STATE_COOKIE}=${stateCookie}`,
      ),
    );
    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toBe(
      "/workspace/reef/issues",
    );
    const callbackSetCookie = callbackResponse.headers.get("set-cookie") ?? "";
    expect(callbackSetCookie).toContain(`${AUTH_V2_SESSION_COOKIE}=`);
    expect(callbackSetCookie).not.toContain("fixture-code");
    expect(callbackSetCookie).not.toContain("fixture-refresh-token");
    expect(callbackSetCookie).not.toContain("access_token");
    const handleMatch = new RegExp(`${AUTH_V2_SESSION_COOKIE}=([^;]+)`).exec(
      callbackSetCookie,
    );
    if (!handleMatch) throw new Error("missing auth-v2 handle");
    const handle = handleMatch[1];

    const checked = await session(
      makeRequest(
        "/api/auth/v2/session",
        `${AUTH_V2_SESSION_COOKIE}=${handle}`,
      ),
    );
    expect(checked.status).toBe(200);
    await expect(checked.json()).resolves.toEqual({ user: USER });

    nowSeconds = NOW + 10;
    const refreshed = await refresh(
      makeRequest(
        "/api/auth/v2/refresh",
        `${AUTH_V2_SESSION_COOKIE}=${handle}`,
      ),
    );
    expect(refreshed.status).toBe(200);
    expect(tokenResponseCount).toBe(2);
    await expect(refreshed.json()).resolves.toEqual({ user: USER });

    const loggedOut = await logout(
      makeRequest("/api/auth/v2/logout", `${AUTH_V2_SESSION_COOKIE}=${handle}`),
    );
    expect(loggedOut.status).toBe(204);
    expect(loggedOut.headers.get("set-cookie")).toContain(
      `${AUTH_V2_SESSION_COOKIE}=;`,
    );

    const afterLogout = await session(
      makeRequest(
        "/api/auth/v2/session",
        `${AUTH_V2_SESSION_COOKIE}=${handle}`,
      ),
    );
    expect(afterLogout.status).toBe(401);
  });

  it("denies the account before issuing a Redis session and clears all auth cookies", async () => {
    accountDenial = "membership_required";
    const started = await start(
      makeRequest("/api/auth/v2/start?provider=workforce"),
    );
    const location = new URL(String(started.headers.get("location")));
    const stateCookie = parseCookieHeader(started.headers.get("set-cookie"))[
      AUTH_V2_STATE_COOKIE
    ];
    const parsed = parseAuthV2StateCookie(stateCookie);
    if (!parsed) throw new Error("missing state cookie");
    const state = location.searchParams.get("state") ?? "";
    const encrypted = backend.values.get(loginKey(state));
    if (!encrypted) throw new Error("missing encrypted state");
    currentNonce = JSON.parse(cipher.decrypt(encrypted, loginKey(state)))
      .nonce as string;

    const denied = await callback(
      makeRequest(
        `/api/auth/v2/callback?code=fixture-code&state=${encodeURIComponent(state)}`,
        `${AUTH_V2_STATE_COOKIE}=${stateCookie}`,
      ),
    );
    expect(denied.status).toBe(302);
    expect(denied.headers.get("location")).toBe(
      "/login?sso_error=membership_required",
    );
    expect(denied.headers.get("set-cookie")).toContain(
      `${AUTH_V2_SESSION_COOKIE}=;`,
    );
    expect(
      [...backend.values.keys()].some((key) => key.includes("session:")),
    ).toBe(false);
  });
});
