import type { AuthV2EnabledRuntimeConfig, AuthV2RuntimeConfig } from "./config";
import { importJWK, type JWK } from "jose";

const READINESS_TIMEOUT_MS = 5_000;
const MAX_JWKS_BYTES = 2 * 1024 * 1024;

export type AuthV2ReadinessErrorCode =
  | "auth_v2_readiness_disabled"
  | "auth_v2_redis_unavailable"
  | "auth_v2_keycloak_unavailable"
  | "auth_v2_keyset_invalid";

/** A bounded readiness error; upstream URLs and response bodies never escape. */
export class AuthV2ReadinessError extends Error {
  constructor(readonly code: AuthV2ReadinessErrorCode) {
    super(code);
    this.name = "AuthV2ReadinessError";
  }
}

export interface AuthV2RedisHealthClient {
  ping(): Promise<string>;
}

export interface AuthV2ReadinessDependencies {
  fetch?: typeof fetch;
  redis?: AuthV2RedisHealthClient;
}

/**
 * Check the dependencies required by an enabled auth-v2 deployment.
 *
 * The canonical issuer is never probed here: browser/JWT issuer traffic uses
 * that public address, while service-to-service readiness uses the distinct
 * transport URL supplied by the deployment. Redis is optional only for local
 * development/test configs; production config parsing already fails closed
 * when it is absent, and this check fails closed if its client is not wired.
 */
export async function checkAuthV2Readiness(
  config: AuthV2RuntimeConfig,
  dependencies: AuthV2ReadinessDependencies = {},
): Promise<void> {
  if (!config.enabled) {
    throw new AuthV2ReadinessError("auth_v2_readiness_disabled");
  }

  // Keep the failure order deterministic. Redis is the session dependency and
  // must be reachable before a keyset can make the profile ready; concurrent
  // probes otherwise race and obscure the actionable readiness code.
  await checkRedis(config, dependencies.redis);
  await checkKeycloak(config, dependencies.fetch ?? fetch);
}

async function checkRedis(
  config: AuthV2EnabledRuntimeConfig,
  client: AuthV2RedisHealthClient | undefined,
): Promise<void> {
  if (config.redisUrl === null) return;
  if (!client) {
    throw new AuthV2ReadinessError("auth_v2_redis_unavailable");
  }
  try {
    const response = await withDeadline(client.ping());
    if (response !== "PONG") throw new Error("unexpected redis response");
  } catch {
    throw new AuthV2ReadinessError("auth_v2_redis_unavailable");
  }
}

async function checkKeycloak(
  config: AuthV2EnabledRuntimeConfig,
  fetchImpl: typeof fetch,
): Promise<void> {
  const url = `${config.transportUrl}/protocol/openid-connect/certs`;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json, application/jwk-set+json" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(READINESS_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error("keycloak readiness status");
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_JWKS_BYTES) {
      throw new Error("keycloak readiness body too large");
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_JWKS_BYTES) {
      throw new Error("keycloak readiness body too large");
    }
    const payload: unknown = JSON.parse(new TextDecoder().decode(body));
    if (!payload || typeof payload !== "object") {
      throw new AuthV2ReadinessError("auth_v2_keyset_invalid");
    }
    const keys = (payload as { keys?: unknown }).keys;
    if (!Array.isArray(keys) || keys.length === 0) {
      throw new AuthV2ReadinessError("auth_v2_keyset_invalid");
    }

    let usableSigningKey = false;
    for (const candidate of keys) {
      if (!isUsableRsaSigningKey(candidate)) continue;
      try {
        await importJWK(candidate, "RS256");
        usableSigningKey = true;
        break;
      } catch {
        // Try the next advertised key. A JWKS is ready only when at least one
        // key can actually be imported for the pinned RS256 verifier.
      }
    }
    if (!usableSigningKey) {
      throw new AuthV2ReadinessError("auth_v2_keyset_invalid");
    }
  } catch (error) {
    if (error instanceof AuthV2ReadinessError) throw error;
    throw new AuthV2ReadinessError(
      error instanceof SyntaxError
        ? "auth_v2_keyset_invalid"
        : "auth_v2_keycloak_unavailable",
    );
  }
}

function isUsableRsaSigningKey(value: unknown): value is JWK {
  if (!value || typeof value !== "object") return false;
  const key = value as Partial<JWK>;
  return (
    key.kty === "RSA" &&
    key.alg === "RS256" &&
    key.use === "sig" &&
    typeof key.kid === "string" &&
    key.kid.length > 0 &&
    key.kid.length <= 255 &&
    typeof key.n === "string" &&
    key.n.length > 0 &&
    typeof key.e === "string" &&
    key.e.length > 0
  );
}

async function withDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("readiness deadline exceeded")),
          READINESS_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
