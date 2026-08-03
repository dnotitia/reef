import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./[key]/route";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  adapter: { kind: "test-adapter" },
  getAkbAdapter: vi.fn(),
  getAkbCurrentActor: vi.fn(),
  akbEnsureReefTables: vi.fn(),
  akbListNotifications: vi.fn(),
  akbUpdateNotificationState: vi.fn(),
}));

vi.mock("@/lib/api/requestHelpers", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/requestHelpers")
  >("@/lib/api/requestHelpers");
  return {
    ...actual,
    getAkbAdapter: mocks.getAkbAdapter,
    getAkbCurrentActor: mocks.getAkbCurrentActor,
  };
});

vi.mock("@/lib/api/routeTracing", () => ({
  runRouteSpan: vi.fn(({ run }: { run: () => Promise<unknown> }) => run()),
}));

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbEnsureReefTables: mocks.akbEnsureReefTables,
    akbListNotifications: mocks.akbListNotifications,
    akbUpdateNotificationState: mocks.akbUpdateNotificationState,
  };
});

const notification = {
  notification_key: "notification:5:alice:8:activity:8:REEF-001",
  recipient: "alice",
  reef_id: "REEF-001",
  source_type: "activity",
  source_ref: "event-1",
  event_type: "comment_created",
  actor: "bob",
  occurred_at: "2026-07-28T00:00:00.000Z",
  state: "unread",
};

describe("notification Route Handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAkbAdapter.mockReturnValue({ adapter: mocks.adapter });
    mocks.getAkbCurrentActor.mockResolvedValue({ actor: "alice" });
    mocks.akbEnsureReefTables.mockResolvedValue(undefined);
    mocks.akbListNotifications.mockResolvedValue([notification]);
    mocks.akbUpdateNotificationState.mockResolvedValue({
      ...notification,
      state: "read",
    });
  });

  it("binds list visibility to the session actor even when recipient is forged", async () => {
    const response = await GET(
      new Request(
        "http://reef.test/api/notifications?vault=reef-acme&state=unread&limit=100&recipient=bob",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notifications: [notification] });
    expect(mocks.akbListNotifications).toHaveBeenCalledWith(
      mocks.adapter,
      "reef-acme",
      { recipient: "alice", state: "unread", limit: 100 },
    );
    expect(mocks.akbListNotifications.mock.calls[0]?.[2]).not.toHaveProperty(
      "recipient",
      "bob",
    );
  });

  it("injects the session actor into state updates and ignores a forged recipient field", async () => {
    const key = notification.notification_key;
    const response = await PATCH(
      new Request("http://reef.test/api/notifications/update", {
        method: "PATCH",
        body: JSON.stringify({ vault: "reef-acme", state: "read" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ key: encodeURIComponent(key) }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.akbUpdateNotificationState).toHaveBeenCalledWith(
      mocks.adapter,
      "reef-acme",
      { notificationKey: key, recipient: "alice", state: "read" },
    );

    const forged = await PATCH(
      new Request("http://reef.test/api/notifications/update", {
        method: "PATCH",
        body: JSON.stringify({
          vault: "reef-acme",
          state: "read",
          recipient: "bob",
        }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ key: encodeURIComponent(key) }) },
    );
    expect(forged.status).toBe(200);
    expect(mocks.akbUpdateNotificationState).toHaveBeenCalledTimes(2);
    expect(mocks.akbUpdateNotificationState.mock.calls[1]?.[2]).toEqual({
      notificationKey: key,
      recipient: "alice",
      state: "read",
    });
  });
});
