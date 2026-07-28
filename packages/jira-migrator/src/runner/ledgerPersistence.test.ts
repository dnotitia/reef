import { describe, expect, it, vi } from "vitest";
import { createChangeAwarePersister } from "./ledgerPersistence.js";

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
