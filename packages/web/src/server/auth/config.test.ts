// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readAuthRuntimeConfig } from "./config";

const VALID_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");

function ssoEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    REEF_AUTH_MODE: "sso",
    REEF_KEYCLOAK_ISSUER: "https://identity.example.com/realms/reef",
    REEF_KEYCLOAK_TRANSPORT_URL:
      "http://keycloak.identity.svc.cluster.local:8080/realms/reef",
    REEF_KEYCLOAK_CLIENT_ID: "reef-web",
    REEF_AKB_API_AUDIENCE: "akb-api",
    REEF_PUBLIC_ORIGIN: "https://reef.example.com",
    REEF_SESSION_REDIS_URL: "rediss://redis.example.com:6380/0",
    REEF_SESSION_ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
    ...overrides,
  };
}

describe("readAuthRuntimeConfig", () => {
  it("requires a distinct in-cluster Keycloak transport in production", () => {
    expect(() =>
      readAuthRuntimeConfig(
        ssoEnvironment({ REEF_KEYCLOAK_TRANSPORT_URL: undefined }),
      ),
    ).toThrowError("sso_keycloak_transport_required");
    expect(() =>
      readAuthRuntimeConfig(
        ssoEnvironment({
          REEF_KEYCLOAK_TRANSPORT_URL:
            "https://identity.example.com/realms/reef",
        }),
      ),
    ).toThrowError("sso_keycloak_transport_invalid");
  });

  it("keeps the canonical issuer separate from the exact-realm transport URL", () => {
    expect(readAuthRuntimeConfig(ssoEnvironment())).toMatchObject({
      mode: "sso",
      issuer: "https://identity.example.com/realms/reef",
      transportUrl:
        "http://keycloak.identity.svc.cluster.local:8080/realms/reef",
    });
  });

  it.each([
    ["realm mismatch", "http://keycloak:8080/realms/other"],
    ["extra path", "http://keycloak:8080/realms/reef/extra"],
    ["credentials", "http://user:pass@keycloak:8080/realms/reef"],
    ["query", "http://keycloak:8080/realms/reef?internal=true"],
    ["fragment", "http://keycloak:8080/realms/reef#internal"],
    ["IPv4 literal", "http://10.0.0.10:8080/realms/reef"],
    ["IPv6 literal", "http://[fd00::10]:8080/realms/reef"],
    ["public DNS", "https://identity-internal.example.com/realms/reef"],
    ["loopback DNS", "http://localhost:8080/realms/reef"],
  ])("rejects an invalid Keycloak transport with %s", (_label, transport) => {
    expect(() =>
      readAuthRuntimeConfig(
        ssoEnvironment({ REEF_KEYCLOAK_TRANSPORT_URL: transport }),
      ),
    ).toThrowError("sso_keycloak_transport_invalid");
  });

  it("fails closed when production SSO has no Redis URL", () => {
    expect(() =>
      readAuthRuntimeConfig(
        ssoEnvironment({ REEF_SESSION_REDIS_URL: undefined }),
      ),
    ).toThrowError("sso_session_redis_required");
  });

  it("fails closed when the production encryption key is missing or malformed", () => {
    expect(() =>
      readAuthRuntimeConfig(
        ssoEnvironment({ REEF_SESSION_ENCRYPTION_KEY: undefined }),
      ),
    ).toThrowError("sso_session_encryption_key_required");
    expect(() =>
      readAuthRuntimeConfig(
        ssoEnvironment({
          REEF_SESSION_ENCRYPTION_KEY: Buffer.alloc(31).toString("base64url"),
        }),
      ),
    ).toThrowError("sso_session_encryption_key_invalid");
  });

  it("allows an ephemeral in-memory store only outside production", () => {
    const config = readAuthRuntimeConfig(
      ssoEnvironment({
        NODE_ENV: "development",
        REEF_KEYCLOAK_ISSUER: "http://localhost:8080/realms/reef",
        REEF_KEYCLOAK_TRANSPORT_URL: undefined,
        REEF_PUBLIC_ORIGIN: "http://localhost:3000",
        REEF_SESSION_REDIS_URL: undefined,
        REEF_SESSION_ENCRYPTION_KEY: undefined,
      }),
    );

    expect(config).toMatchObject({
      mode: "sso",
      redisUrl: null,
      encryptionKey: null,
      transportUrl: "http://localhost:8080/realms/reef",
    });
  });

  it("rejects missing or unknown modes instead of falling back", () => {
    expect(() => readAuthRuntimeConfig({})).toThrowError("auth_mode_invalid");
    expect(() =>
      readAuthRuntimeConfig({ REEF_AUTH_MODE: "hybrid" }),
    ).toThrowError("auth_mode_invalid");
  });

  it("keeps local mode independent from SSO configuration", () => {
    expect(readAuthRuntimeConfig({ REEF_AUTH_MODE: "local" })).toEqual({
      mode: "local",
    });
  });

  it("rejects non-HTTPS production issuer and public origins", () => {
    expect(() =>
      readAuthRuntimeConfig(
        ssoEnvironment({
          REEF_KEYCLOAK_ISSUER: "http://identity.example.com/realms/reef",
        }),
      ),
    ).toThrowError("sso_issuer_invalid");
    expect(() =>
      readAuthRuntimeConfig(
        ssoEnvironment({ REEF_PUBLIC_ORIGIN: "https://reef.example.com/app" }),
      ),
    ).toThrowError("sso_public_origin_invalid");
  });

  it("rejects a canonical issuer that is not an exact realm URL", () => {
    expect(() =>
      readAuthRuntimeConfig(
        ssoEnvironment({
          REEF_KEYCLOAK_ISSUER: "https://identity.example.com/realms/reef/sub",
        }),
      ),
    ).toThrowError("sso_issuer_invalid");
  });
});
