// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  type RedisSessionClient,
  createRedisSessionBackend,
} from "./redisSessionBackend";

function createFakeRedis(): RedisSessionClient {
  const values = new Map<string, string>();
  return {
    async set(key, value, options) {
      if (options.NX && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    async get(key) {
      return values.get(key) ?? null;
    },
    async getDel(key) {
      const value = values.get(key) ?? null;
      values.delete(key);
      return value;
    },
    async eval(script, { keys, arguments: args }) {
      const key = keys[0] ?? "";
      if (script.includes("separator")) {
        const current = values.get(key);
        if (!current || current.split("|", 1)[0] !== args[0]) return 0;
        values.set(key, args[1] ?? "");
        return 1;
      }
      if (values.get(key) === args[0]) {
        values.delete(key);
        return 1;
      }
      return 0;
    },
    async del(key) {
      return values.delete(key) ? 1 : 0;
    },
  };
}

describe("Redis session backend", () => {
  it("uses atomic compare-and-set and owner-checked lock release", async () => {
    const backend = createRedisSessionBackend(createFakeRedis());
    await expect(
      backend.setIfAbsent("session", "1|sealed", 1_000),
    ).resolves.toBe(true);
    await expect(
      backend.compareAndSet("session", 1, "2|rotated", 1_000),
    ).resolves.toBe(true);
    await expect(
      backend.compareAndSet("session", 1, "2|stale", 1_000),
    ).resolves.toBe(false);
    await expect(backend.get("session")).resolves.toBe("2|rotated");

    await backend.setIfAbsent("lock", "owner-a", 1_000);
    await backend.deleteIfValue("lock", "owner-b");
    await expect(backend.get("lock")).resolves.toBe("owner-a");
    await backend.deleteIfValue("lock", "owner-a");
    await expect(backend.get("lock")).resolves.toBeNull();
  });
});
