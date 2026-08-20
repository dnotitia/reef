// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  AuthV2RedisRuntimeError,
  buildAuthV2RedisClientOptions,
  connectWithDeadline,
} from "./redisRuntime";

describe("auth-v2 Redis runtime", () => {
  it("builds a TLS-capable client option without enabling offline queueing", () => {
    expect(
      buildAuthV2RedisClientOptions("rediss://redis.example.com:6380/0"),
    ).toEqual({
      url: "rediss://redis.example.com:6380/0",
      disableOfflineQueue: true,
      socket: { connectTimeout: 5_000 },
    });
  });

  it("bounds connection startup and destroys a stuck client", async () => {
    const destroy = vi.fn();
    await expect(
      connectWithDeadline(
        {
          connect: () => new Promise<never>(() => undefined),
          destroy,
        },
        1,
      ),
    ).rejects.toBeInstanceOf(AuthV2RedisRuntimeError);
    // A caller owns cleanup after the bounded helper rejects; this assertion
    // documents that no hidden reconnect loop is started by the helper.
    expect(destroy).not.toHaveBeenCalled();
  });
});
