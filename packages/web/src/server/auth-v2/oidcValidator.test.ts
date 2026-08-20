// @vitest-environment node

import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  AccountValidationError,
  createOidcTokenValidator,
  DEFAULT_OIDC_CLOCK_TOLERANCE_SECONDS,
  MAX_OIDC_CLOCK_TOLERANCE_SECONDS,
  validateOidcTokenAndAccount,
  type OidcTokenValidator,
} from "./oidcValidator";
import { AKB_AUTH_V2_ACCOUNT_DENIAL_CODES } from "@reef/core";

const ISSUER = "https://identity.example.com/realms/reef";
const AUDIENCE = "akb-api";
const CLIENT = "reef-web";
const PROVIDER = "workforce";
const NOW_SECONDS = 2_000_000_000;
const KID = "reef-test-key";

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { modulusLength: 2048 });
  privateKey = pair.privateKey;
  jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID }],
  });
});

function validator(
  overrides: Partial<Parameters<typeof createOidcTokenValidator>[0]> = {},
): OidcTokenValidator {
  return createOidcTokenValidator({
    canonicalIssuer: ISSUER,
    audience: AUDIENCE,
    clientId: CLIENT,
    providerAlias: PROVIDER,
    jwks,
    now: () => new Date(NOW_SECONDS * 1_000),
    ...overrides,
  });
}

async function token(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): Promise<string> {
  return new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: "subject-1",
    azp: CLIENT,
    identity_provider: PROVIDER,
    typ: "Bearer",
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 300,
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: KID, ...header })
    .sign(privateKey);
}

describe("auth-v2 OIDC token validator", () => {
  it("pins issuer, audience, azp, provider, and Bearer claims", async () => {
    await expect(validator().validate(await token())).resolves.toMatchObject({
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: "subject-1",
      authorizedParty: CLIENT,
      providerAlias: PROVIDER,
      tokenType: "Bearer",
      expiresAt: NOW_SECONDS + 300,
    });
  });

  it.each([
    ["issuer", { iss: "https://other.example.com/realms/reef" }],
    ["audience", { aud: "other-api" }],
    ["azp", { azp: "other-client" }],
    ["provider alias", { identity_provider: "other-provider" }],
    ["token type", { typ: "Access" }],
    ["subject", { sub: "" }],
  ])("rejects a token with a wrong %s", async (_label, claims) => {
    await expect(
      validator().validate(await token(claims)),
    ).rejects.toMatchObject({ code: "oidc_token_invalid", kind: "invalid" });
  });

  it("rejects a token for another AKB catalog audience", async () => {
    await expect(
      validator({ audience: "other-api" }).validate(await token()),
    ).rejects.toMatchObject({ code: "oidc_token_invalid" });
  });

  it("accepts a configured audience alongside another recipient", async () => {
    await expect(
      validator().validate(await token({ aud: [AUDIENCE, "other-api"] })),
    ).resolves.toBeDefined();
  });

  it("pins verification to RS256 and rejects token-directed key sources", async () => {
    const hsToken = await new SignJWT({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "subject-1",
      azp: CLIENT,
      identity_provider: PROVIDER,
      typ: "Bearer",
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 300,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .sign(new Uint8Array(Buffer.alloc(32, 2)));

    for (const name of ["jku", "jwk", "x5u", "x5c"]) {
      await expect(
        validator().validate(await token({}, { [name]: "https://evil.test" })),
      ).rejects.toMatchObject({ code: "oidc_token_invalid", kind: "invalid" });
    }
    await expect(validator().validate(hsToken)).rejects.toMatchObject({
      code: "oidc_token_invalid",
      kind: "invalid",
    });
  });

  it("uses a bounded clock tolerance and rejects stale tokens outside it", async () => {
    expect(DEFAULT_OIDC_CLOCK_TOLERANCE_SECONDS).toBe(5);
    expect(MAX_OIDC_CLOCK_TOLERANCE_SECONDS).toBe(60);

    await expect(
      validator().validate(await token({ exp: NOW_SECONDS - 4 })),
    ).resolves.toBeDefined();
    await expect(
      validator().validate(await token({ exp: NOW_SECONDS - 6 })),
    ).rejects.toMatchObject({ code: "oidc_token_invalid" });
    await expect(
      validator().validate(await token({ iat: NOW_SECONDS + 5 })),
    ).resolves.toBeDefined();
    await expect(
      validator().validate(await token({ iat: NOW_SECONDS + 6 })),
    ).rejects.toMatchObject({ code: "oidc_token_invalid" });
  });

  it("rejects invalid validator configuration instead of widening trust", () => {
    expect(() => validator({ audience: "" })).toThrow(
      "oidc_validator_config_invalid",
    );
    expect(() =>
      validator({
        clockToleranceSeconds: MAX_OIDC_CLOCK_TOLERANCE_SECONDS + 1,
      }),
    ).toThrow("oidc_validator_config_invalid");
    expect(() =>
      validator({ canonicalIssuer: "http://identity.example.com/realms/reef" }),
    ).toThrow("oidc_validator_config_invalid");
  });

  it("requires an explicit accepted AKB account result", async () => {
    const oidc = validator();
    const accessToken = await token({ preferred_username: "from-keycloak" });
    const accountValidator = async (input: { subject: string }) => {
      expect(input.subject).toBe("subject-1");
      return { outcome: "accepted" as const, account: { id: "akb-1" } };
    };

    await expect(
      validateOidcTokenAndAccount(accessToken, oidc, accountValidator),
    ).resolves.toMatchObject({ account: { id: "akb-1" } });
  });

  it.each(AKB_AUTH_V2_ACCOUNT_DENIAL_CODES)(
    "surfaces the AKB denial %s without a claim fallback",
    async (code) => {
      const oidc = validator();
      await expect(
        validateOidcTokenAndAccount(
          await token({ email: "claims@example.com" }),
          oidc,
          async () => ({
            outcome: "denied",
            code,
          }),
        ),
      ).rejects.toMatchObject({
        name: "AccountValidationError",
        code,
        kind: "denied",
      });
    },
  );

  it("does not turn an unavailable or malformed AKB response into an account", async () => {
    const oidc = validator();
    await expect(
      validateOidcTokenAndAccount(await token(), oidc, undefined as never),
    ).rejects.toMatchObject({
      name: "AccountValidationError",
      code: "account_validation_required",
    });

    await expect(
      validateOidcTokenAndAccount(await token(), oidc, async () => ({
        outcome: "unavailable",
      })),
    ).rejects.toMatchObject({
      name: "AccountValidationError",
      code: "account_validation_unavailable",
    });

    await expect(
      validateOidcTokenAndAccount(
        await token({ preferred_username: "untrusted" }),
        oidc,
        async () => ({}) as never,
      ),
    ).rejects.toMatchObject({
      name: "AccountValidationError",
      code: "account_validation_invalid",
    });
  });

  it("maps account-validator failures to a bounded boundary error", async () => {
    await expect(
      validateOidcTokenAndAccount(await token(), validator(), async () => {
        throw new Error("AKB response contained credentials");
      }),
    ).rejects.toEqual(
      expect.objectContaining(
        new AccountValidationError(
          "account_validation_unavailable",
          "unavailable",
        ),
      ),
    );
  });
});
