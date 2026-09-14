// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  AuthV2RedisBackendError,
  createAuthV2RedisBackend,
  type AuthV2RedisClient,
} from "./redisBackend";

const KEY = "test:reef:auth-v2:session:key";

function client(overrides: Partial<AuthV2RedisClient> = {}): AuthV2RedisClient {
  return {
    set: vi.fn(async () => "OK"),
    get: vi.fn(async () => "ciphertext"),
    getDel: vi.fn(async () => "state"),
    del: vi.fn(async () => 1),
    eval: vi.fn(async () => 1),
    sAdd: vi.fn(async () => 1),
    sMembers: vi.fn(async () => ["handle"]),
    sRem: vi.fn(async () => 1),
    expire: vi.fn(async () => true),
    ...overrides,
  };
}

describe("auth-v2 Redis backend", () => {
  it("passes the effective TTL through SET and compare-and-set", async () => {
    const redis = client();
    const backend = createAuthV2RedisBackend(redis);

    await backend.set(KEY, "ciphertext", 600);
    await backend.replace(KEY, "old", "new", 300);

    expect(redis.set).toHaveBeenCalledWith(KEY, "ciphertext", { EX: 600 });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining(
        'redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])',
      ),
      {
        keys: [KEY],
        arguments: ["old", "new", "300"],
      },
    );
  });

  it("keeps one-time consume and session-index operations on the adapter", async () => {
    const redis = client();
    const backend = createAuthV2RedisBackend(redis);

    await expect(backend.consume(KEY)).resolves.toBe("state");
    await backend.addToSet?.(`${KEY}:sid`, "handle", 120);
    await expect(backend.members?.(`${KEY}:sid`)).resolves.toEqual(["handle"]);
    await backend.removeFromSet?.(`${KEY}:sid`, "handle");

    expect(redis.getDel).toHaveBeenCalledWith(KEY);
    expect(redis.sAdd).toHaveBeenCalledWith(`${KEY}:sid`, "handle");
    expect(redis.expire).toHaveBeenCalledWith(`${KEY}:sid`, 120);
    expect(redis.sMembers).toHaveBeenCalledWith(`${KEY}:sid`);
    expect(redis.sRem).toHaveBeenCalledWith(`${KEY}:sid`, "handle");
  });

  it("maps Redis transport failures to a bounded backend error", async () => {
    const redis = client({
      get: vi.fn(async () => {
        throw new Error("redis://secret-host must not escape");
      }),
    });
    const backend = createAuthV2RedisBackend(redis);

    await expect(backend.get(KEY)).rejects.toBeInstanceOf(
      AuthV2RedisBackendError,
    );
    await expect(backend.get(KEY)).rejects.not.toThrow("secret-host");
  });
});
