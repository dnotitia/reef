// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  type AuthV2EnabledRuntimeConfig,
  AuthV2ConfigurationError,
  readAuthV2RuntimeConfig,
  requireAuthV2RuntimeConfig,
  summarizeAuthV2RuntimeConfig,
} from "./config";

const VALID_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
const TRANSPORT_WITH_CREDENTIALS = (() => {
  const url = new URL("http://keycloak:8080/realms/reef");
  url.username = "user";
  url.password = "pass";
  return url.toString();
})();

function enabledEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    REEF_AUTH_V2_ENABLED: "1",
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

describe("readAuthV2RuntimeConfig", () => {
  it("keeps auth-v2 disabled until explicitly opted in", () => {
    expect(readAuthV2RuntimeConfig({ NODE_ENV: "production" })).toEqual({
      enabled: false,
    });
    expect(
      readAuthV2RuntimeConfig({
        NODE_ENV: "production",
        REEF_AUTH_V2_ENABLED: "false",
      }),
    ).toEqual({ enabled: false });
  });

  it("rejects an unknown opt-in value instead of guessing", () => {
    expect(() =>
      readAuthV2RuntimeConfig({ REEF_AUTH_V2_ENABLED: "yes" }),
    ).toThrowError("auth_v2_opt_in_invalid");
  });

  it("loads the canonical issuer separately from the in-cluster transport", () => {
    expect(readAuthV2RuntimeConfig(enabledEnvironment())).toMatchObject({
      enabled: true,
      issuer: "https://identity.example.com/realms/reef",
      transportUrl:
        "http://keycloak.identity.svc.cluster.local:8080/realms/reef",
      clientId: "reef-web",
      audience: "akb-api",
    });
  });

  it("requires a distinct in-cluster transport in production", () => {
    expect(() =>
      readAuthV2RuntimeConfig(
        enabledEnvironment({ REEF_KEYCLOAK_TRANSPORT_URL: undefined }),
      ),
    ).toThrowError("auth_v2_transport_required");
    expect(() =>
      readAuthV2RuntimeConfig(
        enabledEnvironment({
          REEF_KEYCLOAK_TRANSPORT_URL:
            "https://identity.example.com/realms/reef",
        }),
      ),
    ).toThrowError("auth_v2_transport_invalid");
  });

  it.each([
    ["realm mismatch", "http://keycloak:8080/realms/other"],
    ["extra path", "http://keycloak:8080/realms/reef/extra"],
    ["credentials", TRANSPORT_WITH_CREDENTIALS],
    ["query", "http://keycloak:8080/realms/reef?internal=true"],
    ["fragment", "http://keycloak:8080/realms/reef#internal"],
    ["IPv4 literal", "http://10.0.0.10:8080/realms/reef"],
    ["IPv6 literal", "http://[fd00::10]:8080/realms/reef"],
    ["public DNS", "https://identity-internal.example.com/realms/reef"],
    [
      "public DNS with svc label",
      "https://identity.svc.example.com/realms/reef",
    ],
    ["loopback DNS", "http://localhost:8080/realms/reef"],
  ])("rejects an invalid transport with %s", (_label, transport) => {
    expect(() =>
      readAuthV2RuntimeConfig(
        enabledEnvironment({ REEF_KEYCLOAK_TRANSPORT_URL: transport }),
      ),
    ).toThrowError("auth_v2_transport_invalid");
  });

  it("requires production Redis and a dedicated 32-byte encryption key", () => {
    expect(() =>
      readAuthV2RuntimeConfig(
        enabledEnvironment({ REEF_SESSION_REDIS_URL: undefined }),
      ),
    ).toThrowError("auth_v2_redis_required");
    expect(() =>
      readAuthV2RuntimeConfig(
        enabledEnvironment({ REEF_SESSION_ENCRYPTION_KEY: undefined }),
      ),
    ).toThrowError("auth_v2_encryption_key_required");
    expect(() =>
      readAuthV2RuntimeConfig(
        enabledEnvironment({
          REEF_SESSION_ENCRYPTION_KEY: Buffer.alloc(31).toString("base64url"),
        }),
      ),
    ).toThrowError("auth_v2_encryption_key_invalid");
  });

  it("accepts both strict base64 encodings for exactly 32 bytes", () => {
    const standard = Buffer.alloc(32, 9).toString("base64");
    const config = readAuthV2RuntimeConfig(
      enabledEnvironment({ REEF_SESSION_ENCRYPTION_KEY: standard }),
    );
    expect(config.enabled).toBe(true);
    if (!config.enabled) throw new Error("expected enabled config");
    expect(config.encryptionKey).toEqual(new Uint8Array(Buffer.alloc(32, 9)));
  });

  it("allows only ephemeral storage and issuer transport outside production", () => {
    const config = readAuthV2RuntimeConfig(
      enabledEnvironment({
        NODE_ENV: "development",
        REEF_KEYCLOAK_ISSUER: "http://localhost:8080/realms/reef",
        REEF_KEYCLOAK_TRANSPORT_URL: undefined,
        REEF_PUBLIC_ORIGIN: "http://localhost:3000",
        REEF_SESSION_REDIS_URL: undefined,
        REEF_SESSION_ENCRYPTION_KEY: undefined,
      }),
    );

    expect(config).toMatchObject({
      enabled: true,
      issuer: "http://localhost:8080/realms/reef",
      transportUrl: "http://localhost:8080/realms/reef",
      redisUrl: null,
      encryptionKey: null,
    });
  });

  it("rejects insecure production URLs and non-realm issuers", () => {
    expect(() =>
      readAuthV2RuntimeConfig(
        enabledEnvironment({
          REEF_KEYCLOAK_ISSUER: "http://identity.example.com/realms/reef",
        }),
      ),
    ).toThrowError("auth_v2_issuer_invalid");
    expect(() =>
      readAuthV2RuntimeConfig(
        enabledEnvironment({ REEF_PUBLIC_ORIGIN: "http://reef.example.com" }),
      ),
    ).toThrowError("auth_v2_public_origin_invalid");
    expect(() =>
      readAuthV2RuntimeConfig(
        enabledEnvironment({
          REEF_KEYCLOAK_ISSUER:
            "https://identity.example.com/realms/reef/subrealm",
        }),
      ),
    ).toThrowError("auth_v2_issuer_invalid");
  });

  it("does not put secret values in configuration errors or summaries", () => {
    const redisSecret = "rediss://:super-secret@redis.example.com:6380/0";
    const config = readAuthV2RuntimeConfig(
      enabledEnvironment({ REEF_SESSION_REDIS_URL: redisSecret }),
    );
    expect(config.enabled).toBe(true);
    if (!config.enabled) throw new Error("expected enabled config");
    const summary = summarizeAuthV2RuntimeConfig(config);
    expect(summary).toEqual({
      enabled: true,
      redisConfigured: true,
      encryptionKeyConfigured: true,
    });
    expect(JSON.stringify(summary)).not.toContain(redisSecret);

    const secretKey = VALID_ENCRYPTION_KEY;
    try {
      readAuthV2RuntimeConfig(
        enabledEnvironment({
          REEF_KEYCLOAK_TRANSPORT_URL: `http://user:${secretKey}@keycloak.identity.svc.cluster.local:8080/realms/reef`,
        }),
      );
      throw new Error("expected invalid transport");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthV2ConfigurationError);
      expect(String(error)).not.toContain(secretKey);
    }
  });

  it("requires explicit opt-in when a caller demands the enabled profile", () => {
    expect(() => requireAuthV2RuntimeConfig({})).toThrowError(
      "auth_v2_opt_in_invalid",
    );
    const config = requireAuthV2RuntimeConfig(
      enabledEnvironment(),
    ) satisfies AuthV2EnabledRuntimeConfig;
    expect(config.enabled).toBe(true);
  });
});
