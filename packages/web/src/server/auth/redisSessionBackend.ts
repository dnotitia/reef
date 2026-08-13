import type { SessionStorageBackend } from "./sessionRepository";

export interface RedisSessionClient {
  set(
    key: string,
    value: string,
    options: { PX: number; NX: true },
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
  getDel(key: string): Promise<string | null>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

const COMPARE_AND_SET = `
local current = redis.call("GET", KEYS[1])
if not current then return 0 end
local separator = string.find(current, "|", 1, true)
if not separator then return 0 end
if string.sub(current, 1, separator - 1) ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], ARGV[2], "PX", ARGV[3])
return 1
`;

const DELETE_IF_VALUE = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export function createRedisSessionBackend(
  client: RedisSessionClient,
): SessionStorageBackend {
  return {
    async setIfAbsent(key, value, ttlMs) {
      return (await client.set(key, value, { PX: ttlMs, NX: true })) === "OK";
    },
    get(key) {
      return client.get(key);
    },
    getAndDelete(key) {
      return client.getDel(key);
    },
    async compareAndSet(key, expectedRevision, value, ttlMs) {
      const result = await client.eval(COMPARE_AND_SET, {
        keys: [key],
        arguments: [String(expectedRevision), value, String(ttlMs)],
      });
      return Number(result) === 1;
    },
    async delete(key) {
      await client.del(key);
    },
    async deleteIfValue(key, expectedValue) {
      await client.eval(DELETE_IF_VALUE, {
        keys: [key],
        arguments: [expectedValue],
      });
    },
  };
}
