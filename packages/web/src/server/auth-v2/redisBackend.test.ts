// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  AuthV2RedisBackendError,
  createAuthV2RedisBackend,
  type AuthV2RedisClient,
} from "./redisBackend";

function client(): AuthV2RedisClient {
  return {
    set: vi.fn(async () => "OK"),
    get: vi.fn(async () => "ciphertext"),
    getDel: vi.fn(async () => "one-time"),
    del: vi.fn(async () => 1),
    eval: vi.fn(async () => 1),
  };
}

describe("auth-v2 Redis backend", () => {
  it("uses TTL writes and atomic GETDEL consumption", async () => {
    const redis = client();
    const backend = createAuthV2RedisBackend(redis);

    await backend.set("reef:auth-v2:session:hash", "ciphertext", 120);
    await expect(backend.get("reef:auth-v2:session:hash")).resolves.toBe(
      "ciphertext",
    );
    await expect(backend.consume("reef:auth-v2:login:hash")).resolves.toBe(
      "one-time",
    );
    await backend.del("reef:auth-v2:session:hash");
    await expect(
      backend.replace("reef:auth-v2:session:hash", "old", "new", 120),
    ).resolves.toBe(true);

    expect(redis.set).toHaveBeenCalledWith(
      "reef:auth-v2:session:hash",
      "ciphertext",
      { EX: 120 },
    );
    expect(redis.getDel).toHaveBeenCalledWith("reef:auth-v2:login:hash");
  });

  it("rejects malformed keys and clients without atomic consumption", async () => {
    expect(() => createAuthV2RedisBackend({} as AuthV2RedisClient)).toThrow(
      AuthV2RedisBackendError,
    );
    const backend = createAuthV2RedisBackend(client());
    await expect(backend.get("bad\nkey")).rejects.toThrow(
      AuthV2RedisBackendError,
    );
    await expect(backend.set("key", "value", 0)).rejects.toThrow(
      AuthV2RedisBackendError,
    );
  });
});
