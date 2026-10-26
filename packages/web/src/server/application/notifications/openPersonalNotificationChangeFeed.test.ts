import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AkbStreamAdapter } from "@reef/core";

const { listActiveWorkspaces } = vi.hoisted(() => ({
  listActiveWorkspaces: vi.fn(),
}));

vi.mock("@/server/application/workspaces/listActiveWorkspaces", () => ({
  listActiveWorkspaces,
}));

import { openPersonalNotificationChangeFeed } from "./openPersonalNotificationChangeFeed";

function notificationChangeFrame(vault: string): Uint8Array {
  const event = {
    version: 1,
    cursor: "cursor-1",
    occurred_at: "2026-10-26T00:00:00.000Z",
    vault,
    kind: "table.rows_changed",
    resource_uri: `akb://${vault}/table/reef_notifications`,
    payload: { operation: "insert" },
  };
  return new TextEncoder().encode(
    `event: change\nid: cursor-1\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

describe("openPersonalNotificationChangeFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listActiveWorkspaces.mockResolvedValue(["reef-alpha", "reef-beta"]);
  });

  it("aborts every active source and settles the pending consumer when closed", async () => {
    const signals: AbortSignal[] = [];
    const emitChange = new Map<AbortSignal, () => boolean>();
    const adapter = {
      request: vi.fn(),
      stream: vi.fn(async (_path: string, init?: { signal?: AbortSignal }) => {
        const signal = init?.signal;
        if (!signal) throw new Error("Expected an upstream abort signal");
        signals.push(signal);

        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start(streamController) {
            controller = streamController;
            signal.addEventListener(
              "abort",
              () => {
                controller.close();
              },
              { once: true },
            );
          },
        });
        emitChange.set(signal, () => {
          if (signal.aborted) return false;
          const vault = _path.slice(_path.lastIndexOf("/") + 1);
          controller.enqueue(notificationChangeFrame(vault));
          return true;
        });
        return new Response(body, {
          headers: { "content-type": "text/event-stream" },
        });
      }),
    } satisfies AkbStreamAdapter;

    const feed = await openPersonalNotificationChangeFeed({ adapter });
    expect(signals).toHaveLength(2);
    const siblingFeed = await openPersonalNotificationChangeFeed({ adapter });
    expect(signals).toHaveLength(4);
    const pendingChange = feed.nextChange();

    feed.close();

    const [firstFeedSignals, siblingFeedSignals] = [
      signals.slice(0, 2),
      signals.slice(2),
    ];
    expect(firstFeedSignals.every((signal) => signal.aborted)).toBe(true);
    expect(siblingFeedSignals.every((signal) => !signal.aborted)).toBe(true);
    expect(
      firstFeedSignals.map((signal) => emitChange.get(signal)?.()),
    ).toEqual([false, false]);
    const siblingEmitters = siblingFeedSignals.map((signal) =>
      emitChange.get(signal),
    );
    expect(siblingEmitters).toHaveLength(2);
    expect(siblingEmitters[0]?.()).toBe(true);

    await expect(pendingChange).resolves.toBe(false);
    await expect(siblingFeed.nextChange()).resolves.toBe(true);
    expect(siblingFeedSignals.every((signal) => !signal.aborted)).toBe(true);

    siblingFeed.close();
    expect(siblingFeedSignals.every((signal) => signal.aborted)).toBe(true);
  });
});
