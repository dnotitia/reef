// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readAuthV2RuntimeConfig } from "./config";

const productionSsoEnv = {
  NODE_ENV: "production",
  REEF_AUTH_MODE: "sso",
  REEF_KEYCLOAK_ISSUER: "https://idp.test/realms/reef",
  REEF_KEYCLOAK_TRANSPORT_URL:
    "http://keycloak.auth.svc.cluster.local/realms/reef",
  REEF_KEYCLOAK_CLIENT_ID: "reef-web",
  REEF_AKB_API_AUDIENCE: "https://akb.test/api",
  REEF_PUBLIC_ORIGIN: "https://reef.example.com",
  REEF_SESSION_REDIS_URL: "redis://redis.auth.svc.cluster.local:6379",
  REEF_SESSION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  REEF_AUTH_SESSION_NAMESPACE: "reef-production",
};

describe("auth-v2 runtime config", () => {
  it("keeps local mode free of OIDC and Redis requirements", () => {
    expect(
      readAuthV2RuntimeConfig({
        NODE_ENV: "production",
        REEF_AUTH_MODE: "local",
      }),
    ).toEqual({ enabled: false, mode: "local" });
  });

  it.each([
    ["REEF_KEYCLOAK_ISSUER", "auth_v2_issuer_invalid"],
    ["REEF_KEYCLOAK_TRANSPORT_URL", "auth_v2_transport_required"],
    ["REEF_KEYCLOAK_CLIENT_ID", "auth_v2_client_id_invalid"],
    ["REEF_AKB_API_AUDIENCE", "auth_v2_audience_invalid"],
    ["REEF_PUBLIC_ORIGIN", "auth_v2_public_origin_invalid"],
    ["REEF_SESSION_REDIS_URL", "auth_v2_redis_required"],
    ["REEF_SESSION_ENCRYPTION_KEY", "auth_v2_encryption_key_required"],
    ["REEF_AUTH_SESSION_NAMESPACE", "auth_v2_session_namespace_required"],
  ])("rejects a production SSO profile missing %s", (field, code) => {
    expect(() =>
      readAuthV2RuntimeConfig({
        ...productionSsoEnv,
        [field]: undefined,
      }),
    ).toThrowError(expect.objectContaining({ code }));
  });

  it("accepts the complete production SSO profile", () => {
    expect(readAuthV2RuntimeConfig(productionSsoEnv)).toMatchObject({
      enabled: true,
      mode: "sso",
      issuer: "https://idp.test/realms/reef",
      clientId: "reef-web",
      audience: "https://akb.test/api",
      sessionNamespace: "reef-production",
    });
  });

  it("accepts a complete development SSO profile", () => {
    const config = readAuthV2RuntimeConfig({
      ...productionSsoEnv,
      NODE_ENV: "test",
      REEF_KEYCLOAK_TRANSPORT_URL: undefined,
      REEF_PUBLIC_ORIGIN: "http://localhost:3000",
      REEF_AUTH_SESSION_NAMESPACE: "test",
    });
    expect(config).toMatchObject({
      enabled: true,
      mode: "sso",
      issuer: "https://idp.test/realms/reef",
      clientId: "reef-web",
      audience: "https://akb.test/api",
      sessionNamespace: "test",
    });
  });

  it.each([
    ["production", "https://reef.example.com", "https://reef.example.com"],
    ["production", "https://reef.example.com/", "https://reef.example.com"],
    ["production", "https://REEF.Example.COM", "https://reef.example.com"],
    ["production", "https://reef.example.com:443", "https://reef.example.com"],
    [
      "production",
      "https://reef.example.com:8443",
      "https://reef.example.com:8443",
    ],
    ["development", "http://localhost:3000", "http://localhost:3000"],
    ["development", "http://127.0.0.1:8080", "http://127.0.0.1:8080"],
    ["test", "http://[::1]:8080", "http://[::1]:8080"],
  ])("canonicalizes %s SSO public origin %s", (nodeEnv, origin, expected) => {
    const config = readAuthV2RuntimeConfig({
      ...productionSsoEnv,
      NODE_ENV: nodeEnv,
      REEF_PUBLIC_ORIGIN: origin,
    });
    expect(config).toMatchObject({ enabled: true, publicOrigin: expected });
  });

  it.each([
    ["production", "http://localhost:3000"],
    ["development", "http://reef.example.com"],
    ["production", "reef.example.com"],
    ["production", "//reef.example.com"],
    ["production", "ftp://reef.example.com"],
    ["production", "https://reef.example.com/api/auth/akb/sso/callback"],
    ["production", "https://reef.example.com/?x=1"],
    ["production", "https://reef.example.com#frag"],
    ["production", "https://user:pass@reef.example.com"],
  ])("rejects unsafe %s SSO public origin %s", (nodeEnv, origin) => {
    expect(() =>
      readAuthV2RuntimeConfig({
        ...productionSsoEnv,
        NODE_ENV: nodeEnv,
        REEF_PUBLIC_ORIGIN: origin,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "auth_v2_public_origin_invalid" }),
    );
  });

  it("rejects an unknown mode without falling back", () => {
    expect(() =>
      readAuthV2RuntimeConfig({
        NODE_ENV: "production",
        REEF_AUTH_MODE: "hybrid",
      }),
    ).toThrowError(expect.objectContaining({ code: "auth_mode_invalid" }));
  });
});
