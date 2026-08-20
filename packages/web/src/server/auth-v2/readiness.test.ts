// @vitest-environment node

import { beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair } from "jose";
import {
  type AuthV2EnabledRuntimeConfig,
  readAuthV2RuntimeConfig,
} from "./config";
import {
  checkAuthV2Readiness,
  type AuthV2ReadinessError,
  type AuthV2RedisHealthClient,
} from "./readiness";

const config = readAuthV2RuntimeConfig({
  NODE_ENV: "production",
  REEF_AUTH_V2_ENABLED: "1",
  REEF_KEYCLOAK_ISSUER: "https://identity.example.com/realms/reef",
  REEF_KEYCLOAK_TRANSPORT_URL:
    "http://keycloak.identity.svc.cluster.local:8080/realms/reef",
  REEF_KEYCLOAK_CLIENT_ID: "reef-web",
  REEF_AKB_API_AUDIENCE: "akb-api",
  REEF_PUBLIC_ORIGIN: "https://reef.example.com",
  REEF_SESSION_REDIS_URL: "rediss://redis.example.com:6380/0",
  REEF_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
});

function enabled(): AuthV2EnabledRuntimeConfig {
  if (!config.enabled) throw new Error("expected enabled config");
  return config;
}

function redis(ping: () => Promise<string>): AuthV2RedisHealthClient {
  return { ping };
}

function jwksResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let usableKey: Record<string, unknown>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { modulusLength: 2048 });
  usableKey = {
    ...(await exportJWK(pair.publicKey)),
    alg: "RS256",
    use: "sig",
    kid: "reef-key",
  };
});

describe("auth-v2 readiness", () => {
  it("probes only the in-cluster JWKS transport and Redis", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jwksResponse({ keys: [usableKey] }));
    const ping = vi.fn(async () => "PONG");

    await expect(
      checkAuthV2Readiness(enabled(), {
        fetch: fetchImpl,
        redis: redis(ping),
      }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://keycloak.identity.svc.cluster.local:8080/realms/reef/protocol/openid-connect/certs",
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("fails closed when Redis is not wired or does not answer PONG", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => jwksResponse({ keys: [usableKey] }));
    await expect(
      checkAuthV2Readiness(enabled(), { fetch: fetchImpl }),
    ).rejects.toMatchObject({
      code: "auth_v2_redis_unavailable",
    });

    await expect(
      checkAuthV2Readiness(enabled(), {
        fetch: fetchImpl,
        redis: redis(async () => "NOPE"),
      }),
    ).rejects.toMatchObject({
      code: "auth_v2_redis_unavailable",
    });
  });

  it("distinguishes an invalid JWKS document from transport failure", async () => {
    const redisClient = redis(async () => "PONG");
    await expect(
      checkAuthV2Readiness(enabled(), {
        redis: redisClient,
        fetch: vi.fn().mockResolvedValue(jwksResponse({})),
      }),
    ).rejects.toMatchObject({
      code: "auth_v2_keyset_invalid",
    });

    await expect(
      checkAuthV2Readiness(enabled(), {
        redis: redisClient,
        fetch: vi.fn().mockResolvedValue(jwksResponse({ keys: [] })),
      }),
    ).rejects.toMatchObject({
      code: "auth_v2_keyset_invalid",
    });

    await expect(
      checkAuthV2Readiness(enabled(), {
        redis: redisClient,
        fetch: vi.fn().mockResolvedValue(jwksResponse({ keys: [{}] })),
      }),
    ).rejects.toMatchObject({
      code: "auth_v2_keyset_invalid",
    });

    await expect(
      checkAuthV2Readiness(enabled(), {
        redis: redisClient,
        fetch: vi.fn().mockRejectedValue(new Error("down")),
      }),
    ).rejects.toMatchObject({
      code: "auth_v2_keycloak_unavailable",
    });
  });

  it("does not require Redis for development/test ephemeral config", async () => {
    const development = readAuthV2RuntimeConfig({
      NODE_ENV: "development",
      REEF_AUTH_V2_ENABLED: "1",
      REEF_KEYCLOAK_ISSUER: "http://localhost:8080/realms/reef",
      REEF_PUBLIC_ORIGIN: "http://localhost:3000",
      REEF_KEYCLOAK_CLIENT_ID: "reef-web",
      REEF_AKB_API_AUDIENCE: "akb-api",
    });
    await expect(
      checkAuthV2Readiness(development, {
        fetch: vi.fn().mockResolvedValue(jwksResponse({ keys: [usableKey] })),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a disabled profile", async () => {
    await expect(
      checkAuthV2Readiness({ enabled: false }),
    ).rejects.toMatchObject({
      code: "auth_v2_readiness_disabled",
    });
  });
});
