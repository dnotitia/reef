import { AuthError } from "@reef/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  adapter: { kind: "test-adapter" },
  getAkbAdapter: vi.fn(),
  getAkbCurrentActor: vi.fn(),
  markAllPersonalNotificationsRead: vi.fn(),
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

vi.mock(
  "@/server/application/notifications/markAllPersonalNotificationsRead",
  () => ({
    markAllPersonalNotificationsRead: mocks.markAllPersonalNotificationsRead,
  }),
);

describe("POST /api/notifications/read-all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAkbAdapter.mockReturnValue({ adapter: mocks.adapter });
    mocks.getAkbCurrentActor.mockResolvedValue({ actor: "alice" });
    mocks.markAllPersonalNotificationsRead.mockResolvedValue({
      targets: [],
      completed: [],
      unresolved: [],
    });
  });

  it("uses the authenticated actor and returns the confirmed result", async () => {
    const response = await POST(
      new Request("http://reef.test/api/notifications/read-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: { targets: [], completed: [], unresolved: [] },
    });
    expect(mocks.markAllPersonalNotificationsRead).toHaveBeenCalledWith({
      adapter: mocks.adapter,
      actor: "alice",
      targets: undefined,
    });
  });

  it("rejects client-supplied recipient and workspace scope", async () => {
    const response = await POST(
      new Request("http://reef.test/api/notifications/read-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: "bob",
          workspaces: ["raw-vault"],
          targets: [],
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.markAllPersonalNotificationsRead).not.toHaveBeenCalled();
  });

  it("limits retries to validated targets and keeps resource permission denial at 403", async () => {
    const targets = [{ workspace: "reef-alpha", notification_key: "same-key" }];
    mocks.markAllPersonalNotificationsRead.mockRejectedValueOnce(
      new AuthError({ origin: "akb", code: "permission_denied", status: 403 }),
    );

    const response = await POST(
      new Request("http://reef.test/api/notifications/read-all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "__reef_session=established",
        },
        body: JSON.stringify({ targets }),
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.markAllPersonalNotificationsRead).toHaveBeenCalledWith({
      adapter: mocks.adapter,
      actor: "alice",
      targets,
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-reef-auth-invalidated")).toBeNull();
  });
});
