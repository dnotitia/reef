// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  AuthV2RefreshLockError,
  createAuthV2RefreshLock,
  lockKey,
  type AuthV2RefreshLockClient,
} from "./refreshLock";

function client(): AuthV2RefreshLockClient {
  return {
    set: vi.fn(async () => "OK"),
    eval: vi.fn(async () => 1),
  };
}

describe("auth-v2 refresh lock", () => {
  it("acquires with SET NX and releases only its own owner", async () => {
    const redis = client();
    const lock = createAuthV2RefreshLock(redis);
    const owner = await lock.acquire("a".repeat(43), 10);
    expect(owner).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(redis.set).toHaveBeenCalledWith(lockKey("a".repeat(43)), owner, {
      EX: 10,
      NX: true,
    });
    if (!owner) throw new Error("expected lock owner");
    await lock.release("a".repeat(43), owner);
    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining("GET"), {
      keys: [lockKey("a".repeat(43))],
      arguments: [owner],
    });
  });

  it("returns contention and rejects invalid lock inputs", async () => {
    const redis = client();
    redis.set = vi.fn(async () => null);
    const lock = createAuthV2RefreshLock(redis);
    await expect(lock.acquire("b".repeat(43))).resolves.toBeNull();
    await expect(lock.acquire("bad")).rejects.toThrow(AuthV2RefreshLockError);
    await expect(lock.acquire("b".repeat(43), 31)).rejects.toThrow(
      AuthV2RefreshLockError,
    );
    await expect(lock.release("bad", "secret")).resolves.toBeUndefined();
  });
});
