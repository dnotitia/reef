// @vitest-environment node
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createOidcTokenValidator } from "./oidcValidator";
import type { OidcTokenValidationError } from "./oidcValidator";

describe("OIDC access-token validator", () => {
  it("accepts the current AKB RS256 bearer profile", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", {
      modulusLength: 2048,
    });
    const jwks = createLocalJWKSet({
      keys: [{ ...(await exportJWK(publicKey)), kid: "key-1" }],
    });
    const now = 2_000_000_000;
    const token = await new SignJWT({
      aud: "https://akb.test/api",
      sub: "subject-1",
      azp: "reef-web",
      identity_provider: "workforce",
      typ: "Bearer",
      iat: now,
      exp: now + 300,
      jti: "jti-1",
      sid: "sid-1",
      scope: "openid profile",
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "key-1" })
      .setIssuer("https://idp.test/realms/reef")
      .sign(privateKey);
    const validator = createOidcTokenValidator({
      canonicalIssuer: "https://idp.test/realms/reef",
      audience: "https://akb.test/api",
      clientId: "reef-web",
      providerAlias: "workforce",
      providerType: "keycloak-oidc",
      jwks,
      now: () => new Date(now * 1_000),
    });
    await expect(validator.validate(token)).resolves.toMatchObject({
      subject: "subject-1",
      sessionId: "sid-1",
      providerAlias: "workforce",
    });
  });

  it("rejects broker claims on the local realm profile", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", {
      modulusLength: 2048,
    });
    const jwks = createLocalJWKSet({
      keys: [{ ...(await exportJWK(publicKey)), kid: "key-1" }],
    });
    const now = 2_000_000_000;
    const token = await new SignJWT({
      aud: "aud",
      sub: "subject",
      azp: "client",
      identity_provider: "workforce",
      typ: "Bearer",
      iat: now,
      exp: now + 300,
      jti: "jti",
      sid: "sid",
      scope: "openid",
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "key-1" })
      .setIssuer("https://idp.test/realms/reef")
      .sign(privateKey);
    const validator = createOidcTokenValidator({
      canonicalIssuer: "https://idp.test/realms/reef",
      audience: "aud",
      clientId: "client",
      providerAlias: "local-realm",
      providerType: "local-realm",
      jwks,
      now: () => new Date(now * 1_000),
    });
    await expect(validator.validate(token)).rejects.toMatchObject({
      code: "oidc_token_invalid",
    } satisfies Partial<OidcTokenValidationError>);
  });
});
