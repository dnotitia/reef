import { createRemoteJWKSet } from "jose";
import {
  type AkbAuthV2Config,
  type AkbUser,
  akbValidateAuthV2Account,
  isAkbAccountErrorCode,
} from "@reef/core";
import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import { loadAkbAuthV2Config } from "@/lib/akb/loadAkbAuthV2Config";
import {
  requireAuthV2RuntimeConfig,
  type AuthV2EnabledRuntimeConfig,
} from "./config";
import { createAuthV2LoginStateStore } from "./loginStateStore";
import {
  createAuthV2OidcProtocol,
  type AuthV2OidcProtocol,
} from "./oidcProtocol";
import type {
  AccountValidationResult,
  AccountValidator,
} from "./oidcValidator";
import { connectAuthV2Redis, type AuthV2RedisRuntime } from "./redisRuntime";
import { createAuthV2SessionCipher } from "./sessionCipher";
import {
  createAuthV2SessionStore,
  type AuthV2SessionStore,
} from "./sessionStore";

export type AuthV2SsoContract = Extract<AkbAuthV2Config, { auth_mode: "sso" }>;

export interface AuthV2RouteRuntime {
  config: AuthV2EnabledRuntimeConfig;
  contract: AuthV2SsoContract;
  store: AuthV2SessionStore;
  stateStore: ReturnType<typeof createAuthV2LoginStateStore>;
  refreshLock: AuthV2RedisRuntime["refreshLock"];
  now: () => number;
  protocolFor(providerAlias: string): AuthV2OidcProtocol;
  accountValidator: AccountValidator<AkbUser>;
  close(): Promise<void>;
}

export class AuthV2RouteRuntimeError extends Error {
  constructor(
    readonly code:
      | "auth_v2_disabled"
      | "auth_v2_contract_unavailable"
      | "auth_v2_contract_invalid"
      | "auth_v2_runtime_unavailable",
  ) {
    super(code);
    this.name = "AuthV2RouteRuntimeError";
  }
}

/**
 * Build the complete auth-v2 dependency graph for one Route Handler request.
 * The default path is deliberately explicit and expensive: a deployment must
 * provide the v2 catalog and a live Redis connection before a handler can
 * issue or resolve an auth-v2 cookie. Tests inject this same interface with a
 * hermetic backend, keeping the Route Handler boundary real without making a
 * memory store a production fallback.
 */
export async function getAuthV2RouteRuntime(): Promise<AuthV2RouteRuntime> {
  let config: AuthV2EnabledRuntimeConfig;
  try {
    config = requireAuthV2RuntimeConfig();
  } catch {
    throw new AuthV2RouteRuntimeError("auth_v2_disabled");
  }

  const loaded = await loadAkbAuthV2Config();
  if (!loaded.ok) {
    throw new AuthV2RouteRuntimeError(
      loaded.reason === "contract_mismatch"
        ? "auth_v2_contract_invalid"
        : "auth_v2_contract_unavailable",
    );
  }
  const contract = loaded.config;
  if (contract.auth_mode !== "sso") {
    throw new AuthV2RouteRuntimeError("auth_v2_contract_invalid");
  }

  let redis: AuthV2RedisRuntime;
  try {
    redis = await connectAuthV2Redis(config);
  } catch {
    throw new AuthV2RouteRuntimeError("auth_v2_runtime_unavailable");
  }

  const encryptionKey = config.encryptionKey;
  if (!encryptionKey) {
    await redis.close();
    throw new AuthV2RouteRuntimeError("auth_v2_runtime_unavailable");
  }

  const cipher = createAuthV2SessionCipher(encryptionKey);
  const now = () => Math.floor(Date.now() / 1_000);
  const store = createAuthV2SessionStore({
    backend: redis.backend,
    cipher,
    now,
  });
  const stateStore = createAuthV2LoginStateStore({
    backend: redis.backend,
    cipher,
    now,
  });
  const jwks = createRemoteJWKSet(
    new URL(`${config.transportUrl}/protocol/openid-connect/certs`),
    { timeoutDuration: 5_000 },
  );
  const protocolCache = new Map<string, AuthV2OidcProtocol>();
  const protocolFor = (providerAlias: string): AuthV2OidcProtocol => {
    const existing = protocolCache.get(providerAlias);
    if (existing) return existing;
    const protocol = createAuthV2OidcProtocol({
      runtime: config,
      contract,
      providerAlias,
      jwks,
    });
    protocolCache.set(providerAlias, protocol);
    return protocol;
  };

  const accountValidator: AccountValidator<AkbUser> = async (input) => {
    let baseUrl: string;
    try {
      baseUrl = getAkbBackendUrl();
    } catch {
      return { outcome: "unavailable" };
    }
    try {
      const result = await akbValidateAuthV2Account({
        baseUrl,
        accessToken: input.accessToken,
        providerAlias: input.providerAlias,
        subject: input.subject,
      });
      return { outcome: "accepted", account: result.user };
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "context" in error &&
        typeof error.context === "object" &&
        error.context !== null &&
        "code" in error.context &&
        typeof error.context.code === "string"
          ? error.context.code
          : null;
      if (isAkbAccountErrorCode(code)) {
        return { outcome: "denied", code };
      }
      return { outcome: "unavailable" };
    }
  };

  return {
    config,
    contract,
    store,
    stateStore,
    refreshLock: redis.refreshLock,
    now,
    protocolFor,
    accountValidator,
    close: redis.close,
  };
}
