import { randomBytes } from "node:crypto";
import { createClient } from "redis";
import { readAuthRuntimeConfig } from "./config";
import { createKeycloakOidcClient } from "./oidcClient";
import {
  type RedisSessionClient,
  createRedisSessionBackend,
} from "./redisSessionBackend";
import { createSessionCipher } from "./sessionCipher";
import {
  createEncryptedSessionRepository,
  createMemorySessionBackend,
} from "./sessionRepository";
import { createSsoSessionService } from "./ssoSessionService";

export interface SsoAuthRuntime {
  config: Extract<ReturnType<typeof readAuthRuntimeConfig>, { mode: "sso" }>;
  oidc: ReturnType<typeof createKeycloakOidcClient>;
  repository: ReturnType<typeof createEncryptedSessionRepository>;
  sessions: ReturnType<typeof createSsoSessionService>;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __reefSsoAuthRuntime?: Promise<SsoAuthRuntime>;
};

const REDIS_IO_TIMEOUT_MS = 5_000;

export function getSsoAuthRuntime(): Promise<SsoAuthRuntime> {
  if (!runtimeGlobal.__reefSsoAuthRuntime) {
    const pending = createRuntime();
    runtimeGlobal.__reefSsoAuthRuntime = pending;
    void pending.catch(() => {
      if (runtimeGlobal.__reefSsoAuthRuntime === pending) {
        delete runtimeGlobal.__reefSsoAuthRuntime;
      }
    });
  }
  return runtimeGlobal.__reefSsoAuthRuntime;
}

async function createRuntime(): Promise<SsoAuthRuntime> {
  const config = readAuthRuntimeConfig();
  if (config.mode !== "sso") {
    throw new Error("sso_auth_mode_required");
  }

  const backend = config.redisUrl
    ? await connectRedisBackend(config.redisUrl)
    : createMemorySessionBackend();
  const encryptionKey = config.encryptionKey ?? new Uint8Array(randomBytes(32));
  const repository = createEncryptedSessionRepository({
    backend,
    cipher: createSessionCipher(encryptionKey),
  });
  const oidc = createKeycloakOidcClient({
    issuer: config.issuer,
    clientId: config.clientId,
    akbApiAudience: config.akbApiAudience,
    publicOrigin: config.publicOrigin,
  });
  const sessions = createSsoSessionService({ repository, oidc });
  return { config, oidc, repository, sessions };
}

async function connectRedisBackend(redisUrl: string) {
  const client = createClient(buildRedisClientOptions(redisUrl));
  client.on("error", () => {
    // The caller receives the rejected operation. Do not log the client/error:
    // connection errors may include a credential-bearing Redis URL.
  });
  await connectRedisClient(client, REDIS_IO_TIMEOUT_MS);
  return createRedisSessionBackend(client as unknown as RedisSessionClient);
}

interface ConnectableRedisClient {
  connect(): Promise<unknown>;
  destroy(): void;
}

export async function connectRedisClient(
  client: ConnectableRedisClient,
  timeoutMs: number,
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error("sso_session_store_unavailable")),
          timeoutMs,
        );
      }),
    ]);
  } catch {
    try {
      client.destroy();
    } catch {
      // The bounded error below is the only value that crosses this boundary.
    }
    throw new Error("sso_session_store_unavailable");
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export function buildRedisClientOptions(redisUrl: string) {
  return {
    url: redisUrl,
    commandOptions: { timeout: REDIS_IO_TIMEOUT_MS },
    disableOfflineQueue: true,
    socket: { connectTimeout: REDIS_IO_TIMEOUT_MS },
  };
}
