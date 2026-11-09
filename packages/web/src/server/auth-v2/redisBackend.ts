import type { AuthV2SessionBackend } from "./sessionStore";

/**
 * The narrow Redis surface required by auth-v2. The concrete client is created
 * by the deployment runtime with TLS/timeout/offline-queue settings; this
 * adapter deliberately never logs or serializes the configured Redis URL.
 */
export interface AuthV2RedisClient {
  set(
    key: string,
    value: string,
    options: { EX: number; NX?: true },
  ): Promise<string | null | undefined>;
  get(key: string): Promise<string | null>;
  getDel(key: string): Promise<string | null>;
  del(key: string): Promise<number | unknown>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  sAdd?(key: string, member: string): Promise<number | unknown>;
  sMembers?(key: string): Promise<string[]>;
  sRem?(key: string, member: string): Promise<number | unknown>;
  expire?(key: string, seconds: number): Promise<boolean | unknown>;
}

export class AuthV2RedisBackendError extends Error {
  constructor() {
    super("auth_v2_redis_backend_invalid");
    this.name = "AuthV2RedisBackendError";
  }
}

/**
 * Adapt node-redis (or an equivalent TLS Redis client) to the encrypted
 * session store. `getDel` is required so login state and revocation are
 * single-use under concurrent requests; a GET-then-DEL fallback is forbidden.
 */
export function createAuthV2RedisBackend(
  client: AuthV2RedisClient,
): AuthV2SessionBackend {
  if (!client || typeof client !== "object") {
    throw new AuthV2RedisBackendError();
  }
  if (
    typeof client.set !== "function" ||
    typeof client.get !== "function" ||
    typeof client.getDel !== "function" ||
    typeof client.del !== "function" ||
    typeof client.eval !== "function"
  ) {
    throw new AuthV2RedisBackendError();
  }

  return {
    async set(key, value, ttlSeconds) {
      if (
        !isValidKey(key) ||
        !Number.isSafeInteger(ttlSeconds) ||
        ttlSeconds <= 0
      ) {
        throw new AuthV2RedisBackendError();
      }
      await redisCall(() => client.set(key, value, { EX: ttlSeconds }));
    },
    async get(key) {
      if (!isValidKey(key)) throw new AuthV2RedisBackendError();
      return redisCall(() => client.get(key));
    },
    async del(key) {
      if (!isValidKey(key)) throw new AuthV2RedisBackendError();
      await redisCall(() => client.del(key));
    },
    async consume(key) {
      if (!isValidKey(key)) throw new AuthV2RedisBackendError();
      return redisCall(() => client.getDel(key));
    },
    async replace(key, expectedValue, value, ttlSeconds) {
      if (
        !isValidKey(key) ||
        !Number.isSafeInteger(ttlSeconds) ||
        ttlSeconds <= 0
      ) {
        throw new AuthV2RedisBackendError();
      }
      const result = await redisCall(() =>
        client.eval(COMPARE_AND_SET, {
          keys: [key],
          arguments: [expectedValue, value, String(ttlSeconds)],
        }),
      );
      return Number(result) === 1;
    },
    async addToSet(key, member, ttlSeconds) {
      if (!client.sAdd || !client.expire) throw new AuthV2RedisBackendError();
      await redisCall(async () => {
        await client.sAdd?.(key, member);
        await client.expire?.(key, ttlSeconds);
      });
    },
    async members(key) {
      if (!client.sMembers) throw new AuthV2RedisBackendError();
      return redisCall(() => client.sMembers?.(key) ?? Promise.reject());
    },
    async removeFromSet(key, member) {
      if (!client.sRem) throw new AuthV2RedisBackendError();
      await redisCall(() => client.sRem?.(key, member) ?? Promise.reject());
    },
  };
}

const COMPARE_AND_SET = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])
  return 1
end
return 0
`;

function isValidKey(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !hasControlCharacter(value)
  );
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

async function redisCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    // Do not let node-redis include the configured URL or upstream details in
    // the auth boundary. Callers map this bounded error to a retryable 503.
    throw new AuthV2RedisBackendError();
  }
}

type BoundedWrite = {
  key: string;
  data: string;
  expiresIn: number;
  index: string;
  cap: number;
};

export function createBoundedRedisWrite(client: AuthV2RedisClient) {
  return async ({ key, data, expiresIn, index, cap }: BoundedWrite) => {
    const result = await redisCall(() =>
      client.eval(BOUNDED_INSERT, {
        keys: [index, key],
        arguments: [data, String(expiresIn), String(cap)],
      }),
    );
    return Number(result) === 1;
  };
}

const BOUNDED_INSERT = `
local now = tonumber(redis.call("TIME")[1])
local ttl = tonumber(ARGV[2])
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
if redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call("SET", KEYS[2], ARGV[1], "EX", ttl)
redis.call("ZADD", KEYS[1], now + ttl + 1, KEYS[2])
redis.call("EXPIRE", KEYS[1], ttl + 1)
return 1
`;
