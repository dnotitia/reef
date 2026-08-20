// @vitest-environment node

import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  readAuthV2RuntimeConfig,
  type AuthV2EnabledRuntimeConfig,
} from "./config";
import { createAuthV2LoginStateStore, loginKey } from "./loginStateStore";
import { createAuthV2SessionCipher } from "./sessionCipher";
import {
  type AuthV2OidcProtocolError,
  createAuthV2OidcProtocol,
} from "./oidcProtocol";
import type { AuthV2SessionBackend } from "./sessionStore";
import type { AkbAuthV2Config } from "@reef/core";

const NOW = 2_000_000_000;
const ISSUER = "https://identity.example.com/realms/reef";
const TRANSPORT = "http://keycloak.identity.svc.cluster.local:8080/realms/reef";
const KID = "reef-test-key";

class MemoryBackend implements AuthV2SessionBackend {
  values = new Map<string, string>();
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
  async replace(key: string, expectedValue: string, value: string) {
    if (this.values.get(key) !== expectedValue) return false;
    this.values.set(key, value);
    return true;
  }
}

const CONTRACT: Extract<AkbAuthV2Config, { auth_mode: "sso" }> = {
  schema_version: 2,
  auth_mode: "sso",
  local_auth: { enabled: true },
  canonical_issuer: ISSUER,
  accepted_audiences: ["akb-api"],
  accepted_clients: ["reef-web"],
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

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { modulusLength: 2048 });
  privateKey = pair.privateKey;
  jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID }],
  });
});

function runtime(): AuthV2EnabledRuntimeConfig {
  const config = readAuthV2RuntimeConfig({
    NODE_ENV: "development",
    REEF_AUTH_V2_ENABLED: "1",
    REEF_KEYCLOAK_ISSUER: ISSUER,
    REEF_KEYCLOAK_TRANSPORT_URL: TRANSPORT,
    REEF_KEYCLOAK_CLIENT_ID: "reef-web",
    REEF_AKB_API_AUDIENCE: "akb-api",
    REEF_PUBLIC_ORIGIN: "http://localhost:3000",
  });
  if (!config.enabled) throw new Error("expected enabled runtime");
  return config;
}

function makeStateStore(backend: MemoryBackend) {
  const cipher = createAuthV2SessionCipher(new Uint8Array(32).fill(4));
  return {
    store: createAuthV2LoginStateStore({ backend, cipher, now: () => NOW }),
    cipher,
  };
}

async function makeTokens(nonce: string) {
  const accessToken = await new SignJWT({
    iss: ISSUER,
    aud: "akb-api",
    sub: "kc-subject-1",
    azp: "reef-web",
    identity_provider: "workforce",
    typ: "Bearer",
    iat: NOW,
    exp: NOW + 300,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: KID })
    .sign(privateKey);
  const idToken = await new SignJWT({
    iss: ISSUER,
    aud: "reef-web",
    azp: "reef-web",
    sub: "kc-subject-1",
    nonce,
    iat: NOW,
    exp: NOW + 300,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: KID })
    .sign(privateKey);
  return {
    access_token: accessToken,
    refresh_token: "refresh-secret",
    id_token: idToken,
    token_type: "Bearer",
    expires_in: 300,
    refresh_expires_in: 3_600,
    "not-before-policy": 0,
    session_state: "fixture-session-state",
    scope: "openid profile",
  } as const;
}

describe("auth-v2 OIDC protocol", () => {
  it("performs PKCE, validates both tokens, then calls the AKB account boundary", async () => {
    const backend = new MemoryBackend();
    const { store: stateStore, cipher } = makeStateStore(backend);
    let nonce = "";
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        const params = new URLSearchParams(body);
        const state = params.get("state");
        if (state)
          throw new Error("authorization endpoint must not be server-called");
        return new Response(JSON.stringify(await makeTokens(nonce)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const protocol = createAuthV2OidcProtocol({
      runtime: runtime(),
      contract: CONTRACT,
      providerAlias: "workforce",
      jwks,
      fetch: fetchImpl,
      now: () => NOW,
    });

    const started = await protocol.beginAuthorization({
      stateStore,
      redirectPath: "/workspace/reef/issues",
    });
    const authorization = new URL(started.location);
    expect(authorization.origin).toBe("https://identity.example.com");
    expect(authorization.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(authorization.searchParams.get("state")).toBe(started.state);
    expect(authorization.searchParams.get("kc_idp_hint")).toBe("workforce");
    const encrypted = backend.values.get(loginKey(started.state));
    expect(encrypted).toBeDefined();
    if (!encrypted) throw new Error("expected encrypted state");
    const transaction = JSON.parse(
      cipher.decrypt(encrypted, loginKey(started.state)),
    ) as { nonce: string };
    nonce = transaction.nonce;
    const completed = await protocol.completeAuthorization({
      stateStore,
      code: "one-time-code",
      state: started.state,
      browserBinding: started.browserBinding,
      accountValidator: async (input) => {
        expect(input.subject).toBe("kc-subject-1");
        expect(input.providerAlias).toBe("workforce");
        return { outcome: "accepted" as const, account: { id: "akb-1" } };
      },
    });
    expect(completed.account).toEqual({ id: "akb-1" });
    expect(completed.tokenSet.refreshToken).toBe("refresh-secret");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not call Keycloak or create an account when state binding is wrong", async () => {
    const backend = new MemoryBackend();
    const { store: stateStore } = makeStateStore(backend);
    const fetchImpl = vi.fn();
    const protocol = createAuthV2OidcProtocol({
      runtime: runtime(),
      contract: CONTRACT,
      providerAlias: "workforce",
      jwks,
      fetch: fetchImpl,
      now: () => NOW,
    });
    const started = await protocol.beginAuthorization({
      stateStore,
      redirectPath: "/login",
    });
    await expect(
      protocol.completeAuthorization({
        stateStore,
        code: "one-time-code",
        state: started.state,
        browserBinding: "w".repeat(43),
        accountValidator: async () => ({
          outcome: "accepted" as const,
          account: { id: "akb-1" },
        }),
      }),
    ).rejects.toMatchObject({
      code: "auth_v2_state_invalid",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts Keycloak metadata on refresh responses while validating consumed fields", async () => {
    const backend = new MemoryBackend();
    const { store: stateStore } = makeStateStore(backend);
    const tokenSet = await makeTokens("fixture-nonce");
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: tokenSet.access_token,
            refresh_token: "rotated-refresh-secret",
            token_type: "Bearer",
            expires_in: 300,
            refresh_expires_in: 3_600,
            "not-before-policy": 0,
            session_state: "fixture-session-state",
            scope: "openid profile",
          }),
          { status: 200 },
        ),
    );
    const protocol = createAuthV2OidcProtocol({
      runtime: runtime(),
      contract: CONTRACT,
      providerAlias: "workforce",
      jwks,
      fetch: fetchImpl,
      now: () => NOW,
    });

    const refreshed = await protocol.refresh({
      refreshToken: "old-refresh-secret",
      providerAlias: "workforce",
      subject: "kc-subject-1",
      previousIdToken: tokenSet.id_token,
    });
    expect(refreshed.refreshToken).toBe("rotated-refresh-secret");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a provider not advertised by the AKB catalog", () => {
    expect(() =>
      createAuthV2OidcProtocol({
        runtime: runtime(),
        contract: CONTRACT,
        providerAlias: "attacker",
        jwks,
      }),
    ).toThrowError("auth_v2_authorization_input_invalid");
  });
});
