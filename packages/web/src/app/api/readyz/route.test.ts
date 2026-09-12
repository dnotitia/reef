// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth-v2/redisRuntime", () => ({
  connectAuthV2Redis: vi.fn(async () => ({
    ping: async () => "PONG",
    close: async () => undefined,
  })),
}));

vi.mock("@/server/auth-v2/readiness", () => ({
  checkAuthV2Readiness: vi.fn(async () => undefined),
}));

import { GET } from "./route";

describe("GET /api/readyz", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports local mode ready without Redis", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("REEF_AUTH_MODE", "local");
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      auth_mode: "local",
    });
  });

  it("reports SSO readiness without exposing configuration or secrets", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("REEF_AUTH_MODE", "sso");
    vi.stubEnv("REEF_KEYCLOAK_ISSUER", "https://idp.test/realms/reef");
    vi.stubEnv("REEF_KEYCLOAK_CLIENT_ID", "reef-web");
    vi.stubEnv("REEF_AKB_API_AUDIENCE", "https://akb.test/api");
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "http://localhost:3000");
    vi.stubEnv("REEF_SESSION_REDIS_URL", "redis://localhost:6379");
    vi.stubEnv(
      "REEF_SESSION_ENCRYPTION_KEY",
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    );
    vi.stubEnv("REEF_AUTH_SESSION_NAMESPACE", "test");
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      auth_mode: "sso",
    });
  });
});
