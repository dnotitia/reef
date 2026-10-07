import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAkbListMyWorkIssues,
  mockAkbListVaults,
  mockReadWorkspaceInstallationStatus,
} = vi.hoisted(() => ({
  mockAkbListMyWorkIssues: vi.fn(),
  mockAkbListVaults: vi.fn(),
  mockReadWorkspaceInstallationStatus: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbListMyWorkIssues: mockAkbListMyWorkIssues,
    akbListVaults: mockAkbListVaults,
  };
});

vi.mock("@/server/adapters/workspaceInstallation", () => ({
  readWorkspaceInstallationStatus: mockReadWorkspaceInstallationStatus,
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

const vaults = [
  { id: "1", name: "reef-zeta", role: "owner" },
  { id: "2", name: "reef-alpha", role: "member" },
  { id: "3", name: "reef-raw", role: "owner" },
];

describe("listMyWork", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAkbListVaults.mockResolvedValue({ vaults });
    mockReadWorkspaceInstallationStatus
      .mockResolvedValueOnce({ installation_status: "ready" })
      .mockResolvedValueOnce({ installation_status: "ready" })
      .mockResolvedValueOnce({ installation_status: "not_installed" });
    mockAkbListMyWorkIssues.mockResolvedValue({
      workspaces: [],
      issues: [],
      next_offset: null,
      as_of: "2026-10-06T00:00:00.000Z",
    });
  });

  it("queries all and only ready workspaces in one integrated Core call", async () => {
    const adapter = { request: vi.fn() };
    const query = { limit: 25, offset: 50 };

    const result = await listMyWork({ adapter, actor: "alice", query });

    expect(result.issues).toEqual([]);
    expect(mockReadWorkspaceInstallationStatus).toHaveBeenCalledTimes(3);
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
    mockReadWorkspaceInstallationStatus.mockReset();
    mockReadWorkspaceInstallationStatus.mockRejectedValueOnce(denial);

    await expect(
      listMyWork({ adapter: { request: vi.fn() }, actor: "alice" }),
    ).rejects.toBe(denial);
    expect(mockAkbListMyWorkIssues).not.toHaveBeenCalled();
  });
});
