import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AkbAdapter, AkbStreamAdapter } from "@reef/core";

const { listActiveWorkspaces } = vi.hoisted(() => ({
  listActiveWorkspaces: vi.fn(),
}));

vi.mock("@/server/application/workspaces/listActiveWorkspaces", () => ({
  listActiveWorkspaces,
}));

import { openPersonalNotificationChangeFeed } from "./openPersonalNotificationChangeFeed";

afterEach(() => vi.useRealTimers());

describe("openPersonalNotificationChangeFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listActiveWorkspaces.mockResolvedValue(["reef-alpha", "reef-beta"]);
  });

  it("opens a 31-workspace account feed without retaining AKB pool connections", async () => {
    const vaults = Array.from({ length: 31 }, (_, index) => `reef-${index}`);
    listActiveWorkspaces.mockResolvedValue(vaults);
    let retained = 0;
    const controller = new AbortController();
    const adapter = {
      request: vi.fn(async () => ({
        kind: "table_query",
        columns: ["workspace", "revision", "total"],
        items: vaults.map((workspace) => ({
          workspace,
          revision: null,
          total: "0",
        })),
        total: vaults.length,
      })),
      stream: vi.fn(async (_path: string, init?: { signal?: AbortSignal }) => {
        if (retained >= 30)
          throw new Error("AKB pool exhausted: 30 retained SSE connections");
        retained += 1;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              init?.signal?.addEventListener(
                "abort",
                () => {
                  retained -= 1;
                  stream.close();
                },
                { once: true },
              );
            },
          }),
        );
      }),
    } satisfies AkbStreamAdapter;

    try {
      const feed = await openPersonalNotificationChangeFeed({
        adapter,
        actor: "kim",
        signal: controller.signal,
      });
      expect(retained).toBe(0);
      feed.close();
    } finally {
      controller.abort();
    }
  });

  it("cancels a pending poll independently from another account feed", async () => {
    vi.useFakeTimers();
    let revision = "initial";
    const signals: AbortSignal[] = [];
    const adapter = {
      request: vi.fn(async (_path: string, init) => {
        if (init?.signal) signals.push(init.signal);
        return {
          kind: "table_query",
          columns: ["workspace", "revision", "total"],
          total: 2,
          items: ["reef-alpha", "reef-beta"].map((workspace) => ({
            workspace,
            revision,
            total: "1",
          })),
        };
      }),
    } satisfies AkbAdapter;
    const feed = await openPersonalNotificationChangeFeed({
      adapter,
      actor: "kim",
    });
    const sibling = await openPersonalNotificationChangeFeed({
      adapter,
      actor: "kim",
    });
    const pending = feed.nextChange();
    const siblingPending = sibling.nextChange();
    feed.close();
    await expect(pending).resolves.toBe(false);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    revision = "changed";
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(siblingPending).resolves.toBe(true);
    sibling.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a running revision query when its browser consumer leaves", async () => {
    vi.useFakeTimers();
    const adapter = {
      request: vi
        .fn<AkbAdapter["request"]>()
        .mockResolvedValueOnce({
          kind: "table_query",
          columns: ["workspace", "revision", "total"],
          total: 2,
          items: ["reef-alpha", "reef-beta"].map((workspace) => ({
            workspace,
            revision: null,
            total: "0",
          })),
        })
        .mockImplementation(
          (_path, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("closed", "AbortError")),
                { once: true },
              );
            }),
        ),
    } satisfies AkbAdapter;
    const feed = await openPersonalNotificationChangeFeed({
      adapter,
      actor: "kim",
    });
    const pending = feed.nextChange();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(adapter.request).toHaveBeenCalledTimes(2);
    const runningSignal = adapter.request.mock.calls[1]?.[1]?.signal;
    expect(runningSignal?.aborted).toBe(false);
    feed.close();
    await expect(pending).resolves.toBe(false);
    expect(runningSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(adapter.request).toHaveBeenCalledTimes(2);
  });

  it("reports changed account membership even when every notification table is empty", async () => {
    vi.useFakeTimers();
    let workspaces = ["reef-alpha", "reef-beta"];
    listActiveWorkspaces.mockImplementation(async () => workspaces);
    const adapter = {
      request: vi.fn(async () => ({
        kind: "table_query",
        columns: ["workspace", "revision", "total"],
        total: workspaces.length,
        items: workspaces.map((workspace) => ({
          workspace,
          revision: null,
          total: "0",
        })),
      })),
    } satisfies AkbAdapter;
    const feed = await openPersonalNotificationChangeFeed({
      adapter,
      actor: "kim",
    });
    const pending = feed.nextChange();
    workspaces = ["reef-beta"];
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(pending).resolves.toBe(true);
    feed.close();
  });
});
