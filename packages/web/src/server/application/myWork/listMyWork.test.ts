import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAkbListMyWorkIssues, mockListActiveWorkspaces } = vi.hoisted(
  () => ({
    mockAkbListMyWorkIssues: vi.fn(),
    mockListActiveWorkspaces: vi.fn(),
  }),
);

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbListMyWorkIssues: mockAkbListMyWorkIssues,
  };
});

vi.mock("@/server/application/workspaces/listActiveWorkspaces", () => ({
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

import { AuthError } from "@reef/core";
import { listMyWork } from "./listMyWork";

describe("listMyWork", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListActiveWorkspaces.mockResolvedValue(["reef-alpha", "reef-zeta"]);
    mockAkbListMyWorkIssues.mockResolvedValue({
      workspaces: [],
      issues: [],
      next_offset: null,
      as_of: "2026-10-06T00:00:00.000Z",
    });
  });

  it("queries all and only active workspaces in one integrated Core call", async () => {
    const adapter = { request: vi.fn() };
    const query = { limit: 25, offset: 50 };

    const result = await listMyWork({ adapter, actor: "alice", query });

    expect(result.issues).toEqual([]);
    expect(mockAkbListMyWorkIssues).toHaveBeenCalledTimes(1);
    expect(mockAkbListMyWorkIssues).toHaveBeenCalledWith({
      adapter,
      actor: "alice",
      vaults: ["reef-alpha", "reef-zeta"],
      query,
    });
  });

  it("propagates an AKB workspace ACL failure instead of returning partial work", async () => {
    const denial = new AuthError({ origin: "akb", status: 403 });
    mockListActiveWorkspaces.mockRejectedValueOnce(denial);

    await expect(
      listMyWork({ adapter: { request: vi.fn() }, actor: "alice" }),
    ).rejects.toBe(denial);
    expect(mockAkbListMyWorkIssues).not.toHaveBeenCalled();
  });
});
