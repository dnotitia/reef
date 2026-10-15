import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAkbMarkAllPersonalNotificationsRead, mockListActiveWorkspaces } =
  vi.hoisted(() => ({
    mockAkbMarkAllPersonalNotificationsRead: vi.fn(),
    mockListActiveWorkspaces: vi.fn(),
  }));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbMarkAllPersonalNotificationsRead:
      mockAkbMarkAllPersonalNotificationsRead,
  };
});

vi.mock("../workspaces/listActiveWorkspaces", () => ({
  listActiveWorkspaces: mockListActiveWorkspaces,
}));

vi.mock("@/lib/telemetry", () => ({
  tracer: {
    startActiveSpan: async (
      _name: string,
      callback: (span: {
        setAttribute: ReturnType<typeof vi.fn>;
        recordException: ReturnType<typeof vi.fn>;
        setStatus: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      }) => Promise<unknown>,
    ) =>
      callback({
        setAttribute: vi.fn(),
        recordException: vi.fn(),
        setStatus: vi.fn(),
        end: vi.fn(),
      }),
  },
}));

import { markAllPersonalNotificationsRead } from "./markAllPersonalNotificationsRead";

describe("markAllPersonalNotificationsRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListActiveWorkspaces.mockResolvedValue(["reef-alpha", "reef-zeta"]);
    mockAkbMarkAllPersonalNotificationsRead.mockResolvedValue({
      targets: [],
      completed: [],
      unresolved: [],
    });
  });

  it("uses the session actor and all active workspaces for a fresh run", async () => {
    const adapter = { request: vi.fn() };

    await markAllPersonalNotificationsRead({ adapter, actor: "alice" });

    expect(mockListActiveWorkspaces).toHaveBeenCalledWith({ adapter });
    expect(mockAkbMarkAllPersonalNotificationsRead).toHaveBeenCalledWith(
      adapter,
      { recipient: "alice", workspaces: ["reef-alpha", "reef-zeta"] },
    );
  });

  it("passes only the supplied unresolved identities on a retry", async () => {
    const adapter = { request: vi.fn() };
    const targets = [{ workspace: "reef-alpha", notification_key: "same-key" }];

    await markAllPersonalNotificationsRead({
      adapter,
      actor: "alice",
      targets,
    });

    expect(mockAkbMarkAllPersonalNotificationsRead).toHaveBeenCalledWith(
      adapter,
      {
        recipient: "alice",
        workspaces: ["reef-alpha", "reef-zeta"],
        targets,
      },
    );
  });

  it("propagates workspace discovery failures instead of reporting an empty success", async () => {
    const denial = new Error("workspace access denied");
    mockListActiveWorkspaces.mockRejectedValueOnce(denial);

    await expect(
      markAllPersonalNotificationsRead({
        adapter: { request: vi.fn() },
        actor: "alice",
      }),
    ).rejects.toBe(denial);
    expect(mockAkbMarkAllPersonalNotificationsRead).not.toHaveBeenCalled();
  });
});
