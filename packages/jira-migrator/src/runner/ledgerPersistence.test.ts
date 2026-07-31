import { describe, expect, it, vi } from "vitest";
import {
  createBufferedChangeAwarePersister,
  createChangeAwarePersister,
} from "./ledgerPersistence.js";

describe("createChangeAwarePersister", () => {
  it("does not rewrite an unchanged immutable checkpoint", async () => {
    const initial = { revision: 1 };
    const write = vi.fn(async () => undefined);
    const persist = createChangeAwarePersister(initial, write);

    await expect(persist(initial)).resolves.toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("passes the last committed checkpoint as the write precondition", async () => {
    const initial = { revision: 1 };
    const next = { revision: 2 };
    const after = { revision: 3 };
    const write = vi.fn(async () => undefined);
    const persist = createChangeAwarePersister(initial, write);

    await expect(persist(next)).resolves.toBe(true);
    await expect(persist(after)).resolves.toBe(true);
    expect(write).toHaveBeenNthCalledWith(1, next, initial);
    expect(write).toHaveBeenNthCalledWith(2, after, next);
  });

  it("keeps the prior precondition when a write fails", async () => {
    const initial = { revision: 1 };
    const next = { revision: 2 };
    const write = vi
      .fn<(next: typeof initial, expected: typeof initial) => Promise<void>>()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce(undefined);
    const persist = createChangeAwarePersister(initial, write);

    await expect(persist(next)).rejects.toThrow("write failed");
    await expect(persist(next)).resolves.toBe(true);
    expect(write).toHaveBeenNthCalledWith(1, next, initial);
    expect(write).toHaveBeenNthCalledWith(2, next, initial);
  });
});

describe("createBufferedChangeAwarePersister", () => {
  it("flushes after the configured number of changed checkpoints", async () => {
    const initial = { revision: 0 };
    const write = vi.fn(async () => undefined);
    const persist = createBufferedChangeAwarePersister(initial, write, {
      batchSize: 3,
      maxDelayMs: 5_000,
      now: () => 0,
    });
    const first = { revision: 1 };
    const second = { revision: 2 };
    const third = { revision: 3 };

    await expect(persist.checkpoint(first)).resolves.toBe(false);
    await expect(persist.checkpoint(second)).resolves.toBe(false);
    await expect(persist.checkpoint(third)).resolves.toBe(true);
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(third, initial);
  });

  it("flushes a pending checkpoint after the maximum delay", async () => {
    let elapsed = 0;
    const initial = { revision: 0 };
    const next = { revision: 1 };
    const write = vi.fn(async () => undefined);
    const persist = createBufferedChangeAwarePersister(initial, write, {
      batchSize: 50,
      maxDelayMs: 5_000,
      now: () => elapsed,
    });

    await expect(persist.checkpoint(next)).resolves.toBe(false);
    elapsed = 5_000;
    await expect(persist.checkpoint(next)).resolves.toBe(true);
    expect(write).toHaveBeenCalledWith(next, initial);
  });

  it("force-flushes a partial batch and preserves CAS state after failure", async () => {
    const initial = { revision: 0 };
    const first = { revision: 1 };
    const second = { revision: 2 };
    const write = vi
      .fn<(next: typeof initial, expected: typeof initial) => Promise<void>>()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce(undefined);
    const persist = createBufferedChangeAwarePersister(initial, write, {
      batchSize: 50,
      maxDelayMs: 5_000,
      now: () => 0,
    });

    await persist.checkpoint(first);
    await expect(persist.flush()).rejects.toThrow("write failed");
    await persist.checkpoint(second);
    await expect(persist.flush()).resolves.toBe(true);
    expect(write).toHaveBeenNthCalledWith(1, first, initial);
    expect(write).toHaveBeenNthCalledWith(2, second, initial);
  });

  it("does not count the same immutable checkpoint twice", async () => {
    const initial = { revision: 0 };
    const next = { revision: 1 };
    const write = vi.fn(async () => undefined);
    const persist = createBufferedChangeAwarePersister(initial, write, {
      batchSize: 2,
      maxDelayMs: 5_000,
      now: () => 0,
    });

    await persist.checkpoint(next);
    await persist.checkpoint(next);
    expect(write).not.toHaveBeenCalled();
    await expect(persist.flush()).resolves.toBe(true);
    expect(write).toHaveBeenCalledOnce();
  });
});
