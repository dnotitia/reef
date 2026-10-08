import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@reef/core";
import { PATCH } from "./[key]/route";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  adapter: { kind: "test-adapter" },
  getAkbAdapter: vi.fn(),
  getWorkspaceAkbAdapter: vi.fn(),
  getAkbCurrentActor: vi.fn(),
  listPersonalNotifications: vi.fn(),
  akbUpdateNotificationState: vi.fn(),
}));

vi.mock("@/lib/api/requestHelpers", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/requestHelpers")
  >("@/lib/api/requestHelpers");
  return {
    ...actual,
    getAkbAdapter: mocks.getAkbAdapter,
    getWorkspaceAkbAdapter: mocks.getWorkspaceAkbAdapter,
    getAkbCurrentActor: mocks.getAkbCurrentActor,
  };
});

vi.mock("@/lib/api/routeTracing", () => ({
  runRouteSpan: vi.fn(({ run }: { run: () => Promise<unknown> }) => run()),
}));

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/server/application/notifications/listPersonalNotifications", () => ({
  listPersonalNotifications: mocks.listPersonalNotifications,
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
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
const personalNotification = { ...notification, workspace: "reef-acme" };

describe("notification Route Handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAkbAdapter.mockReturnValue({ adapter: mocks.adapter });
    mocks.getWorkspaceAkbAdapter.mockReturnValue({ adapter: mocks.adapter });
    mocks.getAkbCurrentActor.mockResolvedValue({ actor: "alice" });
    mocks.listPersonalNotifications.mockResolvedValue([personalNotification]);
    mocks.akbUpdateNotificationState.mockResolvedValue({
      ...notification,
      state: "read",
    });
  });

  it("lists the account-wide scope without accepting a selected workspace or recipient", async () => {
    const response = await GET(
      new Request(
        "http://reef.test/api/notifications?vault=reef-other&recipient=bob&state=archived&limit=1",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      notifications: [personalNotification],
    });
    expect(mocks.listPersonalNotifications).toHaveBeenCalledWith({
      adapter: mocks.adapter,
      actor: "alice",
    });
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

  it("returns a resource permission denial without clearing the session", async () => {
    mocks.listPersonalNotifications.mockRejectedValueOnce(
      new AuthError({
        origin: "akb",
        code: "permission_denied",
        status: 403,
      }),
    );

    const response = await GET(
      new Request(
        "http://reef.test/api/notifications?vault=reef-acme&state=unread",
        { headers: { Cookie: "__reef_session=established" } },
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/permission|access/i),
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-reef-auth-invalidated")).toBeNull();
  });

  it("keeps a denied notification state update at 403 without treating it as success", async () => {
    mocks.akbUpdateNotificationState.mockRejectedValueOnce(
      new AuthError({
        origin: "akb",
        code: "permission_denied",
        status: 403,
      }),
    );

    const response = await PATCH(
      new Request("http://reef.test/api/notifications/update", {
        method: "PATCH",
        body: JSON.stringify({ vault: "reef-acme", state: "read" }),
        headers: {
          "Content-Type": "application/json",
          Cookie: "__reef_session=established",
        },
      }),
      {
        params: Promise.resolve({
          key: encodeURIComponent(notification.notification_key),
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/permission|access/i),
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-reef-auth-invalidated")).toBeNull();
  });
});
