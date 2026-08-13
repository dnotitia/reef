// @vitest-environment node

import { createHash } from "node:crypto";
import {
  type JWTVerifyGetKey,
  SignJWT,
  createLocalJWKSet,
  errors as joseErrors,
  exportJWK,
  generateKeyPair,
} from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createKeycloakOidcClient } from "./oidcClient";
import { createSessionCipher } from "./sessionCipher";
import {
  createEncryptedSessionRepository,
  createMemorySessionBackend,
} from "./sessionRepository";

const ISSUER = "https://identity.example.com/realms/reef";
const CLIENT_ID = "reef-web";
const API_AUDIENCE = "akb-api";
const PROVIDER = "workforce";
const NONCE = "expected-nonce";
const NOW_SECONDS = 2_000_000_000;

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { modulusLength: 2048 });
  privateKey = pair.privateKey;
  jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: "reef-test-key" }],
  });
});

function client(fetchImpl: typeof fetch = vi.fn()) {
  return createKeycloakOidcClient(
    {
      issuer: ISSUER,
      clientId: CLIENT_ID,
      akbApiAudience: API_AUDIENCE,
      publicOrigin: "https://reef.example.com",
    },
    { fetch: fetchImpl, jwks, now: () => NOW_SECONDS },
  );
}

async function accessToken(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): Promise<string> {
  return new SignJWT({
    iss: ISSUER,
    aud: API_AUDIENCE,
    sub: "subject-1",
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 300,
    azp: CLIENT_ID,
    typ: "Bearer",
    identity_provider: PROVIDER,
    ...claims,
  })
    .setProtectedHeader({
      alg: "RS256",
      typ: "JWT",
      kid: "reef-test-key",
      ...header,
    })
    .sign(privateKey);
}

async function idToken(
  access: string,
  claims: Record<string, unknown> = {},
): Promise<string> {
  const atHash = createHash("sha256")
    .update(access, "ascii")
    .digest()
    .subarray(0, 16)
    .toString("base64url");
  return new SignJWT({
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: "subject-1",
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 300,
    azp: CLIENT_ID,
    nonce: NONCE,
    at_hash: atHash,
    ...claims,
  })
    .setProtectedHeader({
      alg: "RS256",
      typ: "JWT",
      kid: "reef-test-key",
    })
    .sign(privateKey);
}

async function validTokenResponse(nonce = NONCE) {
  const access = await accessToken();
  return {
    access_token: access,
    refresh_token: "refresh-token-material",
    id_token: await idToken(access, { nonce }),
    token_type: "Bearer",
    expires_in: 300,
    refresh_expires_in: 1_800,
  };
}

describe("Keycloak OIDC profile", () => {
  it.each([
    ["issuer", { iss: "https://wrong.example.com/realms/reef" }, {}, NONCE],
    ["audience", { aud: "other-api" }, {}, NONCE],
    ["azp", { azp: "other-client" }, {}, NONCE],
    ["provider", { identity_provider: "other-provider" }, {}, NONCE],
    ["nonce", {}, { nonce: "wrong-nonce" }, NONCE],
    ["access token hash", {}, { at_hash: "wrong-hash" }, NONCE],
  ])("rejects a wrong %s", async (_label, accessClaims, idClaims, nonce) => {
    const access = await accessToken(accessClaims);
    const identity = await idToken(access, idClaims);

    await expect(
      client().validateAuthorizationTokenSet(
        {
          access_token: access,
          refresh_token: "refresh-token-material",
          id_token: identity,
          token_type: "Bearer",
          expires_in: 300,
          refresh_expires_in: 1_800,
        },
        { nonce, providerAlias: PROVIDER },
      ),
    ).rejects.toThrowError("oidc_token_invalid");
  });

  it("rejects algorithm and token-directed key-source confusion", async () => {
    const hsToken = await new SignJWT({
      iss: ISSUER,
      aud: API_AUDIENCE,
      azp: CLIENT_ID,
      typ: "Bearer",
      identity_provider: PROVIDER,
      sub: "subject-1",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(NOW_SECONDS)
      .setExpirationTime(NOW_SECONDS + 300)
      .sign(new Uint8Array(Buffer.alloc(32, 2)));
    const confused = await accessToken(
      {},
      { jku: "https://evil.example/jwks" },
    );

    for (const access of [hsToken, confused]) {
      await expect(
        client().validateAuthorizationTokenSet(
          {
            access_token: access,
            refresh_token: "refresh-token-material",
            id_token: await idToken(access),
            token_type: "Bearer",
            expires_in: 300,
            refresh_expires_in: 1_800,
          },
          { nonce: NONCE, providerAlias: PROVIDER },
        ),
      ).rejects.toThrowError("oidc_token_invalid");
    }
  });

  it("accepts an authorization-code ID token without optional at_hash", async () => {
    const access = await accessToken();

    await expect(
      client().validateAuthorizationTokenSet(
        {
          access_token: access,
          refresh_token: "refresh-token-material",
          id_token: await idToken(access, { at_hash: undefined }),
          token_type: "Bearer",
          expires_in: 300,
          refresh_expires_in: 1_800,
        },
        { nonce: NONCE, providerAlias: PROVIDER },
      ),
    ).resolves.toMatchObject({ accessToken: access });
  });

  it.each([
    ["timeout", new joseErrors.JWKSTimeout()],
    [
      "non-200 response",
      new joseErrors.JOSEError(
        "Expected 200 OK from the JSON Web Key Set HTTP response",
      ),
    ],
  ])("classifies a fixed JWKS %s as transient", async (_label, failure) => {
    const unavailableJwks = vi.fn<JWTVerifyGetKey>().mockRejectedValue(failure);
    const oidc = createKeycloakOidcClient(
      {
        issuer: ISSUER,
        clientId: CLIENT_ID,
        akbApiAudience: API_AUDIENCE,
        publicOrigin: "https://reef.example.com",
      },
      { jwks: unavailableJwks, now: () => NOW_SECONDS },
    );
    const raw = await validTokenResponse();

    await expect(
      oidc.validateAuthorizationTokenSet(raw, {
        nonce: NONCE,
        providerAlias: PROVIDER,
      }),
    ).rejects.toMatchObject({
      code: "oidc_upstream_unavailable",
      kind: "transient",
    });
  });

  it.each([408, 429, 500, 503])(
    "classifies refresh endpoint %s as transient without leaking the refresh token",
    async (status) => {
      const refreshToken = "sensitive-refresh-token";
      const oidc = client(
        vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })),
      );

      const error = await oidc
        .refresh(refreshToken, {
          nonce: NONCE,
          providerAlias: PROVIDER,
        })
        .catch((reason) => reason);

      expect(error).toMatchObject({
        code: "oidc_upstream_unavailable",
        kind: "transient",
      });
      expect(JSON.stringify(error)).not.toContain(refreshToken);
    },
  );

  it.each([400, 401])(
    "classifies refresh endpoint %s as rejected",
    async (status) => {
      const oidc = client(
        vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })),
      );

      await expect(
        oidc.refresh("rejected-refresh-token", {
          nonce: NONCE,
          providerAlias: PROVIDER,
        }),
      ).rejects.toMatchObject({
        code: "oidc_refresh_rejected",
        kind: "rejected",
      });
    },
  );

  it("accepts a standards-compliant refreshed ID token without nonce or at_hash and refuses token redirects", async () => {
    const access = await accessToken();
    const identity = await idToken(access, {
      nonce: undefined,
      at_hash: undefined,
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: access,
        refresh_token: "rotated-refresh-token",
        id_token: identity,
        token_type: "Bearer",
        expires_in: 300,
        refresh_expires_in: 1_800,
      }),
    );

    await expect(
      client(fetchImpl).refresh("current-refresh-token", {
        nonce: NONCE,
        providerAlias: PROVIDER,
      }),
    ).resolves.toMatchObject({
      accessToken: access,
      refreshToken: "rotated-refresh-token",
      idToken: identity,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${ISSUER}/protocol/openid-connect/token`,
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("rejects a wrong refresh nonce when the provider includes one", async () => {
    const access = await accessToken();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: access,
        id_token: await idToken(access, { nonce: "wrong-nonce" }),
        token_type: "Bearer",
        expires_in: 300,
      }),
    );

    await expect(
      client(fetchImpl).refresh("current-refresh-token", {
        nonce: NONCE,
        providerAlias: PROVIDER,
      }),
    ).rejects.toThrowError("oidc_token_invalid");
  });

  it("never follows a refresh-token revocation redirect", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));

    await client(fetchImpl).revokeRefreshToken("refresh-token-material");

    expect(fetchImpl).toHaveBeenCalledWith(
      `${ISSUER}/protocol/openid-connect/revoke`,
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("owns Authorization Code + PKCE and consumes state exactly once", async () => {
    const repository = createEncryptedSessionRepository({
      backend: createMemorySessionBackend(),
      cipher: createSessionCipher(new Uint8Array(Buffer.alloc(32, 5))),
    });
    let tokenResponse: Awaited<ReturnType<typeof validTokenResponse>>;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json(tokenResponse));
    const oidc = client(fetchImpl);
    const started = await oidc.beginAuthorization(repository, {
      providerAlias: PROVIDER,
      redirectPath: "/workspace/example/issues",
    });
    const authorizationUrl = new URL(started.location);

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      `${ISSUER}/protocol/openid-connect/auth`,
    );
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(authorizationUrl.searchParams.get("kc_idp_hint")).toBe(PROVIDER);
    expect(authorizationUrl.searchParams.get("client_id")).toBe(CLIENT_ID);
    tokenResponse = await validTokenResponse(
      authorizationUrl.searchParams.get("nonce") ?? "",
    );

    await expect(
      oidc.completeAuthorization(repository, {
        code: "one-time-code",
        state: authorizationUrl.searchParams.get("state") ?? "",
        browserBinding: started.browserBinding,
      }),
    ).resolves.toMatchObject({
      providerAlias: PROVIDER,
      redirectPath: "/workspace/example/issues",
      tokenSet: {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        idToken: tokenResponse.id_token,
      },
    });
    await expect(
      oidc.completeAuthorization(repository, {
        code: "replayed-code",
        state: authorizationUrl.searchParams.get("state") ?? "",
        browserBinding: started.browserBinding,
      }),
    ).rejects.toThrowError("oidc_state_invalid");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      `${ISSUER}/protocol/openid-connect/token`,
      expect.objectContaining({ redirect: "manual" }),
    );
  });
});
