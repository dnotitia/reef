import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  adapter: { kind: "test-adapter" },
  getAkbAdapter: vi.fn(),
  openFeed: vi.fn(),
}));

vi.mock("@/lib/api/requestHelpers", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/requestHelpers")
  >("@/lib/api/requestHelpers");
  return { ...actual, getAkbAdapter: mocks.getAkbAdapter };
});

vi.mock("@/lib/api/routeTracing", () => ({
  runRouteSpan: vi.fn(({ run }: { run: () => Promise<unknown> }) => run()),
}));

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

vi.mock(
  "@/server/application/notifications/openPersonalNotificationChangeFeed",
  () => ({
    openPersonalNotificationChangeFeed: mocks.openFeed,
  }),
);

describe("GET /api/notifications/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAkbAdapter.mockReturnValue({ adapter: mocks.adapter });
  });

  it("releases the pending feed wait and heartbeat when the consumer cancels", async () => {
    let resolveNextChange!: (hasChange: boolean) => void;
    let resolveWaitFinished!: () => void;
    const waitFinished = new Promise<void>((resolve) => {
      resolveWaitFinished = resolve;
    });
    const feed = {
      nextChange: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveNextChange = (hasChange) => {
              resolve(hasChange);
              resolveWaitFinished();
            };
          }),
      ),
      close: vi.fn(() => resolveNextChange?.(false)),
    };
    mocks.openFeed.mockResolvedValue(feed);

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const response = await GET(
        new Request("http://reef.test/api/notifications/events"),
      );
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      const ready = await reader?.read();
      expect(new TextDecoder().decode(ready?.value)).toContain("event: ready");

      const heartbeatCall = setIntervalSpy.mock.calls.findIndex(
        ([, interval]) => interval === 20_000,
      );
      expect(heartbeatCall).toBeGreaterThanOrEqual(0);
      const heartbeat = setIntervalSpy.mock.results[heartbeatCall]?.value;

      await reader?.cancel();
      await waitFinished;

      expect(feed.close).toHaveBeenCalledOnce();
      expect(clearIntervalSpy).toHaveBeenCalledWith(heartbeat);
      expect(await reader?.read()).toMatchObject({ done: true });
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });
});
