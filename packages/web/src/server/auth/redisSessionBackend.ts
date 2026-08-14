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

const CREATE_INDEXED_SESSION = `
if redis.call("EXISTS", KEYS[1]) == 1 or redis.call("EXISTS", KEYS[2]) == 1 then
  return 0
end
redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[3])
redis.call("SET", KEYS[2], ARGV[2], "PX", ARGV[3])
local ttl = tonumber(ARGV[3])
for index = 3, #KEYS do
  redis.call("SADD", KEYS[index], KEYS[2])
  if redis.call("PTTL", KEYS[index]) < ttl then
    redis.call("PEXPIRE", KEYS[index], ttl)
  end
end
return 1
`;

const COMPARE_AND_SET_INDEXED_SESSION = `
local current = redis.call("GET", KEYS[1])
if not current then return 0 end
local separator = string.find(current, "|", 1, true)
if not separator then return 0 end
if string.sub(current, 1, separator - 1) ~= ARGV[1] then return 0 end
if redis.call("GET", KEYS[2]) ~= ARGV[4] then return 0 end
redis.call("SET", KEYS[1], ARGV[2], "PX", ARGV[3])
redis.call("SET", KEYS[2], ARGV[4], "PX", ARGV[3])
local ttl = tonumber(ARGV[3])
for index = 3, #KEYS do
  redis.call("SADD", KEYS[index], KEYS[2])
  if redis.call("PTTL", KEYS[index]) < ttl then
    redis.call("PEXPIRE", KEYS[index], ttl)
  end
end
return 1
`;

const DELETE_INDEXED_SESSION = `
local metadata = redis.call("GET", KEYS[2])
if metadata then
  local parts = {}
  for part in string.gmatch(metadata, "([^|]+)") do
    table.insert(parts, part)
  end
  if parts[1] == KEYS[1] then
    for index = 2, #parts do
      redis.call("SREM", parts[index], KEYS[2])
      if redis.call("SCARD", parts[index]) == 0 then
        redis.call("DEL", parts[index])
      end
    end
  end
end
redis.call("DEL", KEYS[1], KEYS[2])
return 1
`;

const INVALIDATE_INDEXED_SESSIONS = `
if redis.call("EXISTS", KEYS[2]) == 1 then return -1 end
redis.call("SET", KEYS[2], "1", "PX", ARGV[1])
local members = redis.call("SMEMBERS", KEYS[1])
local invalidated = 0
for _, metadataKey in ipairs(members) do
  local metadata = redis.call("GET", metadataKey)
  if metadata then
    local parts = {}
    for part in string.gmatch(metadata, "([^|]+)") do
      table.insert(parts, part)
    end
    if #parts >= 2 then
      if redis.call("EXISTS", parts[1]) == 1 then
        invalidated = invalidated + 1
      end
      for index = 2, #parts do
        redis.call("SREM", parts[index], metadataKey)
        if redis.call("SCARD", parts[index]) == 0 then
          redis.call("DEL", parts[index])
        end
      end
      redis.call("DEL", parts[1], metadataKey)
    else
      redis.call("SREM", KEYS[1], metadataKey)
      redis.call("DEL", metadataKey)
    end
  else
    redis.call("SREM", KEYS[1], metadataKey)
  end
end
redis.call("DEL", KEYS[1])
return invalidated
`;

function encodeIndexMetadata(
  sessionKey: string,
  indexKeys: readonly string[],
): string {
  return [sessionKey, ...indexKeys].join("|");
}

export function createRedisSessionBackend(
  client: RedisSessionClient,
): SessionStorageBackend {
  return {
    async setIfAbsent(key, value, ttlMs) {
      return (await client.set(key, value, { PX: ttlMs, NX: true })) === "OK";
    },
    async setIndexedSessionIfAbsent(key, metadataKey, value, indexKeys, ttlMs) {
      const result = await client.eval(CREATE_INDEXED_SESSION, {
        keys: [key, metadataKey, ...indexKeys],
        arguments: [value, encodeIndexMetadata(key, indexKeys), String(ttlMs)],
      });
      return Number(result) === 1;
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
    async compareAndSetIndexedSession(
      key,
      metadataKey,
      expectedRevision,
      value,
      indexKeys,
      ttlMs,
    ) {
      const metadata = encodeIndexMetadata(key, indexKeys);
      const result = await client.eval(COMPARE_AND_SET_INDEXED_SESSION, {
        keys: [key, metadataKey, ...indexKeys],
        arguments: [String(expectedRevision), value, String(ttlMs), metadata],
      });
      return Number(result) === 1;
    },
    async delete(key) {
      await client.del(key);
    },
    async deleteIndexedSession(key, metadataKey) {
      await client.eval(DELETE_INDEXED_SESSION, {
        keys: [key, metadataKey],
        arguments: [],
      });
    },
    async invalidateIndexedSessions(indexKey, replayKey, replayTtlMs) {
      const result = Number(
        await client.eval(INVALIDATE_INDEXED_SESSIONS, {
          keys: [indexKey, replayKey],
          arguments: [String(replayTtlMs)],
        }),
      );
      return result < 0
        ? { invalidated: 0, replayed: true }
        : { invalidated: result, replayed: false };
    },
    async deleteIfValue(key, expectedValue) {
      await client.eval(DELETE_IF_VALUE, {
        keys: [key],
        arguments: [expectedValue],
      });
    },
  };
}
