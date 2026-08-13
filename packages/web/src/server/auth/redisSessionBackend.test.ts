// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
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
  it("uses one Redis script for indexed create and replay-protected invalidation", async () => {
    const client = createFakeRedis();
    const evalScript = vi
      .spyOn(client, "eval")
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    const backend = createRedisSessionBackend(client);

    await expect(
      backend.setIndexedSessionIfAbsent(
        "reef:sso:session:hashed-handle",
        "reef:sso:session-meta:hashed-handle",
        "1|sealed",
        ["reef:sso:sid:hashed-sid", "reef:sso:sub:hashed-sub"],
        60_000,
      ),
    ).resolves.toBe(true);
    await expect(
      backend.invalidateIndexedSessions(
        "reef:sso:sid:hashed-sid",
        "reef:sso:logout-jti:hashed-jti",
        180_000,
      ),
    ).resolves.toEqual({ invalidated: 2, replayed: false });

    expect(evalScript).toHaveBeenCalledTimes(2);
    expect(evalScript.mock.calls[0]?.[1]).toMatchObject({
      keys: [
        "reef:sso:session:hashed-handle",
        "reef:sso:session-meta:hashed-handle",
        "reef:sso:sid:hashed-sid",
        "reef:sso:sub:hashed-sub",
      ],
    });
    expect(evalScript.mock.calls[1]?.[1]).toEqual({
      keys: ["reef:sso:sid:hashed-sid", "reef:sso:logout-jti:hashed-jti"],
      arguments: ["180000"],
    });
  });

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
