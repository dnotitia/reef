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
      await client.set(key, value, { EX: ttlSeconds });
    },
    async get(key) {
      if (!isValidKey(key)) throw new AuthV2RedisBackendError();
      return client.get(key);
    },
    async del(key) {
      if (!isValidKey(key)) throw new AuthV2RedisBackendError();
      await client.del(key);
    },
    async consume(key) {
      if (!isValidKey(key)) throw new AuthV2RedisBackendError();
      return client.getDel(key);
    },
    async replace(key, expectedValue, value, ttlSeconds) {
      if (
        !isValidKey(key) ||
        !Number.isSafeInteger(ttlSeconds) ||
        ttlSeconds <= 0
      ) {
        throw new AuthV2RedisBackendError();
      }
      const result = await client.eval(COMPARE_AND_SET, {
        keys: [key],
        arguments: [expectedValue, value, String(ttlSeconds)],
      });
      return Number(result) === 1;
    },
    async addToSet(key, member, ttlSeconds) {
      if (!client.sAdd || !client.expire) throw new AuthV2RedisBackendError();
      await client.sAdd(key, member);
      await client.expire(key, ttlSeconds);
    },
    async members(key) {
      if (!client.sMembers) throw new AuthV2RedisBackendError();
      return client.sMembers(key);
    },
    async removeFromSet(key, member) {
      if (!client.sRem) throw new AuthV2RedisBackendError();
      await client.sRem(key, member);
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
