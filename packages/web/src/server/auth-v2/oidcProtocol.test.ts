// @vitest-environment node
import { createHash } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import type { AkbAuthConfig } from "@reef/core";
import type { AuthV2EnabledRuntimeConfig } from "./config";
import { createAuthV2OidcProtocol } from "./oidcProtocol";

const NOW = 2_000_000_000;
const ISSUER = "https://idp.test/realms/reef";

function atHash(accessToken: string): string {
  return createHash("sha256")
    .update(accessToken, "ascii")
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

describe("companion OIDC protocol", () => {
  it("builds provider-bound PKCE and completes with a verified account", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", {
      modulusLength: 2048,
    });
    const jwks = createLocalJWKSet({
      keys: [{ ...(await exportJWK(publicKey)), kid: "key-1" }],
    });
    const runtime: AuthV2EnabledRuntimeConfig = {
      enabled: true,
      mode: "sso",
      issuer: ISSUER,
      transportUrl: ISSUER,
      clientId: "reef-web",
      audience: "https://akb.test/api",
      publicOrigin: "https://reef.test",
      redisUrl: "redis://localhost:6379",
      encryptionKey: new Uint8Array(32),
      sessionNamespace: "test",
    };
    const contract: Extract<AkbAuthConfig, { auth_mode: "sso" }> = {
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
      ],
      mcp_oauth: { enabled: false },
    };
    let transaction:
      | {
          code_verifier: string;
          nonce: string;
          client_id: string;
        }
      | undefined;
    const stateStore = {
      async issue(input: {
        codeVerifier: string;
        nonce: string;
        clientId: string;
      }) {
        transaction = {
          code_verifier: input.codeVerifier,
          nonce: input.nonce,
          client_id: input.clientId,
        };
        return { state: "state-1", browserBinding: "B".repeat(43) };
      },
      async consume() {
        return transaction
          ? {
              ...transaction,
              provider_alias: "workforce",
              redirect_path: "/workspace/reef",
              issued_at: NOW,
              expires_at: NOW + 600,
            }
          : null;
      },
    };
    const protocol = createAuthV2OidcProtocol({
      runtime,
      contract,
      providerAlias: "workforce",
      jwks,
      now: () => NOW,
      fetch: async (_input, init) => {
        const params = new URLSearchParams(String(init?.body ?? ""));
        expect(params.get("grant_type")).toBe("authorization_code");
        const accessToken = await new SignJWT({
          aud: runtime.audience,
          sub: "subject-1",
          azp: runtime.clientId,
          typ: "Bearer",
          jti: "jti-1",
          sid: "sid-1",
          identity_provider: "workforce",
          scope: "openid profile",
        })
          .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "key-1" })
          .setIssuer(ISSUER)
          .setIssuedAt(NOW)
          .setExpirationTime(NOW + 300)
          .sign(privateKey);
        const idToken = await new SignJWT({
          aud: runtime.clientId,
          azp: runtime.clientId,
          sub: "subject-1",
          sid: "sid-1",
          identity_provider: "workforce",
          nonce: transaction?.nonce,
          at_hash: atHash(accessToken),
          auth_time: NOW,
        })
          .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "key-1" })
          .setIssuer(ISSUER)
          .setIssuedAt(NOW)
          .setExpirationTime(NOW + 300)
          .sign(privateKey);
        return new Response(
          JSON.stringify({
            access_token: accessToken,
            refresh_token: "refresh-1",
            id_token: idToken,
            token_type: "Bearer",
            expires_in: 300,
            refresh_expires_in: 3_600,
          }),
          { status: 200 },
        );
      },
    });

    const started = await protocol.beginAuthorization({
      stateStore,
      redirectPath: "/workspace/reef",
    });
    const authorization = new URL(started.location);
    expect(authorization.searchParams.get("kc_idp_hint")).toBe("workforce");
    expect(authorization.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );

    const completed = await protocol.completeAuthorization({
      stateStore,
      code: "one-time-code",
      state: started.state,
      browserBinding: started.browserBinding,
      accountValidator: async () => ({
        outcome: "accepted" as const,
        account: { id: "u-1", username: "alice" },
      }),
    });
    expect(completed.subject).toBe("subject-1");
    expect(completed.account.username).toBe("alice");
  });
});
