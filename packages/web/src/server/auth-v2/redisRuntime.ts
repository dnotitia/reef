import { createClient } from "redis";
import type { AuthV2EnabledRuntimeConfig } from "./config";
import {
  createAuthV2RedisBackend,
  type AuthV2RedisClient,
} from "./redisBackend";
import {
  createAuthV2RefreshLock,
  type AuthV2RefreshLock,
  type AuthV2RefreshLockClient,
} from "./refreshLock";
import type { AuthV2SessionBackend } from "./sessionStore";

const REDIS_TIMEOUT_MS = 5_000;

export class AuthV2RedisRuntimeError extends Error {
  constructor() {
    super("auth_v2_redis_unavailable");
    this.name = "AuthV2RedisRuntimeError";
  }
}

export interface AuthV2RedisRuntime {
  backend: AuthV2SessionBackend;
  refreshLock: AuthV2RefreshLock;
  ping(): Promise<string>;
  close(): Promise<void>;
}

/**
 * Connect the production Redis dependency with bounded I/O and offline queue
 * disabled. The URL is supplied only to node-redis and is never included in a
 * thrown error or diagnostic object.
 */
export async function connectAuthV2Redis(
  config: AuthV2EnabledRuntimeConfig,
): Promise<AuthV2RedisRuntime> {
  if (!config.redisUrl) throw new AuthV2RedisRuntimeError();
  const client = createClient(buildAuthV2RedisClientOptions(config.redisUrl));
  client.on("error", () => {
    // The operation/readiness caller receives a bounded error. Redis errors
    // can contain the credential-bearing URL, so they are intentionally not
    // logged here.
  });
  try {
    await connectWithDeadline(client, REDIS_TIMEOUT_MS);
    const redisClient = client as unknown as AuthV2RedisClient &
      AuthV2RefreshLockClient;
    return {
      backend: createAuthV2RedisBackend(redisClient),
      refreshLock: createAuthV2RefreshLock(redisClient),
      ping: () => pingWithDeadline(client, REDIS_TIMEOUT_MS),
      close: async () => {
        if (client.isOpen) await client.quit();
      },
    };
  } catch {
    try {
      client.destroy();
    } catch {
      // Keep the public error code stable and secret-free.
    }
    throw new AuthV2RedisRuntimeError();
  }
}

export function buildAuthV2RedisClientOptions(redisUrl: string) {
  return {
    url: redisUrl,
    disableOfflineQueue: true,
    socket: { connectTimeout: REDIS_TIMEOUT_MS },
  } as const;
}

export async function connectWithDeadline(
  client: { connect(): Promise<unknown>; destroy(): void },
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AuthV2RedisRuntimeError()),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function pingWithDeadline(
  client: { ping(): Promise<string> },
  timeoutMs: number,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AuthV2RedisRuntimeError()),
          timeoutMs,
        );
      }),
    ]);
    if (result !== "PONG") throw new AuthV2RedisRuntimeError();
    return result;
  } catch {
    throw new AuthV2RedisRuntimeError();
  } finally {
    if (timer) clearTimeout(timer);
  }
}
