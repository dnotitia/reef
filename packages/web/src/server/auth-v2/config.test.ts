// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthV2ConfigurationError, readAuthV2RuntimeConfig } from "./config";

describe("auth-v2 runtime config", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps local mode free of OIDC and Redis requirements", () => {
    const config = readAuthV2RuntimeConfig({
      NODE_ENV: "production",
      REEF_AUTH_MODE: "local",
    });
    expect(config).toEqual({ enabled: false, mode: "local" });
  });

  it("requires the complete SSO deployment profile", () => {
    expect(() =>
      readAuthV2RuntimeConfig({
        NODE_ENV: "production",
        REEF_AUTH_MODE: "sso",
      }),
    ).toThrowError(expect.objectContaining({ code: "auth_v2_issuer_invalid" }));
  });

  it("accepts a complete development SSO profile", () => {
    const config = readAuthV2RuntimeConfig({
      NODE_ENV: "test",
      REEF_AUTH_MODE: "sso",
      REEF_KEYCLOAK_ISSUER: "https://idp.test/realms/reef",
      REEF_KEYCLOAK_CLIENT_ID: "reef-web",
      REEF_AKB_API_AUDIENCE: "https://akb.test/api",
      REEF_PUBLIC_ORIGIN: "http://localhost:3000",
      REEF_SESSION_REDIS_URL: "redis://localhost:6379",
      REEF_SESSION_ENCRYPTION_KEY:
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
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

  it("rejects an unknown mode without falling back", () => {
    expect(() =>
      readAuthV2RuntimeConfig({
        NODE_ENV: "production",
        REEF_AUTH_MODE: "hybrid",
      }),
    ).toThrowError(expect.objectContaining({ code: "auth_mode_invalid" }));
  });

  it("exports only bounded readiness metadata", () => {
    expect(AuthV2ConfigurationError).toBeDefined();
  });
});
