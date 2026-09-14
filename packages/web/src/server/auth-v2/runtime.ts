import { createRemoteJWKSet } from "jose";
import type { AkbAuthConfig, AkbUser } from "@reef/core";
import { createCompanionAccountValidator } from "./companionLogin";
import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import { loadAkbAuthConfig } from "@/lib/akb/loadAkbAuthConfig";
import {
  requireAuthV2RuntimeConfig,
  type AuthV2EnabledRuntimeConfig,
} from "./config";
import { createAuthV2LoginStateStore } from "./loginStateStore";
import {
  createAuthV2OidcProtocol,
  type AuthV2OidcProtocol,
} from "./oidcProtocol";
import type { AccountValidator } from "./oidcValidator";
import { connectAuthV2Redis, type AuthV2RedisRuntime } from "./redisRuntime";
import { createAuthV2SessionCipher } from "./sessionCipher";
import {
  createAuthV2SessionStore,
  type AuthV2SessionStore,
} from "./sessionStore";

export type AuthV2SsoContract = Extract<AkbAuthConfig, { auth_mode: "sso" }>;

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

export async function getAuthV2RouteRuntime(): Promise<AuthV2RouteRuntime> {
  let config: AuthV2EnabledRuntimeConfig;
  try {
    config = requireAuthV2RuntimeConfig();
  } catch {
    throw new AuthV2RouteRuntimeError("auth_v2_disabled");
  }

  const loaded = await loadAkbAuthConfig();
  if (!loaded.ok) {
    throw new AuthV2RouteRuntimeError("auth_v2_contract_unavailable");
  }
  const contract = loaded.config;
  if (
    contract.auth_mode !== "sso" ||
    !contract.keycloak.enabled ||
    !contract.providers.some((provider) => provider.login_url !== null)
  ) {
    throw new AuthV2RouteRuntimeError("auth_v2_contract_invalid");
  }

  let redis: AuthV2RedisRuntime;
  try {
    redis = await connectAuthV2Redis(config);
  } catch {
    throw new AuthV2RouteRuntimeError("auth_v2_runtime_unavailable");
  }

  const cipher = createAuthV2SessionCipher(config.encryptionKey);
  const now = () => Math.floor(Date.now() / 1_000);
  const store = createAuthV2SessionStore({
    backend: redis.backend,
    cipher,
    namespace: config.sessionNamespace,
    now,
  });
  const stateStore = createAuthV2LoginStateStore({
    backend: redis.backend,
    cipher,
    namespace: config.sessionNamespace,
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

  const accountValidator = createCompanionAccountValidator({
    clientId: config.clientId,
    baseUrl: getAkbBackendUrl,
  });

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
