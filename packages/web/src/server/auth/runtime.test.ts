// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRedisClientOptions, connectRedisClient } from "./runtime";

describe("SSO Redis runtime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets per-attempt and command timeouts without queuing auth operations offline", () => {
    expect(
      buildRedisClientOptions("rediss://redis.example.com:6380/0"),
    ).toEqual({
      url: "rediss://redis.example.com:6380/0",
      commandOptions: { timeout: 5_000 },
      disableOfflineQueue: true,
      socket: { connectTimeout: 5_000 },
    });
  });

  it("bounds the whole initial Redis connection across default reconnects", async () => {
    vi.useFakeTimers();
    const client = {
      connect: vi.fn(() => new Promise<never>(() => undefined)),
      destroy: vi.fn(),
    };

    const connecting = connectRedisClient(client, 50);
    const rejected = expect(connecting).rejects.toThrowError(
      "sso_session_store_unavailable",
    );
    await vi.advanceTimersByTimeAsync(50);

    await rejected;
    expect(client.destroy).toHaveBeenCalledOnce();
  });
});
