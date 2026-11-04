import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, type AkbAdapter } from "@reef/core";

const {
  listVaults,
  getMe,
  listInventory,
  readActive,
  listMembers,
  readTarget,
} = vi.hoisted(() => ({
  listVaults: vi.fn(),
  getMe: vi.fn(),
  listInventory: vi.fn(),
  readActive: vi.fn(),
  listMembers: vi.fn(),
  readTarget: vi.fn(),
}));
vi.mock("@reef/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@reef/core")>()),
  akbListVaults: listVaults,
  akbListMemberActiveVaults: listMembers,
  akbGetMe: getMe,
  akbListAdminActiveInstallations: listInventory,
}));
vi.mock("@/server/adapters/workspaceInstallation", () => ({
  readWorkspaceInstallationActive: readActive,
}));
vi.mock("@/server/adapters/installationTarget", () => ({
  readInstallationTarget: readTarget,
}));
import { listActiveWorkspaces } from "./listActiveWorkspaces";

const adapter = { request: vi.fn() } satisfies AkbAdapter;
const vaults = [
  { id: "active", name: "reef-test", role: "owner" },
  { id: "absent", name: "ordinary-vault", role: "admin" },
  { id: "protected", name: "managed-vault", role: "admin" },
];
const denied = () =>
  new AuthError({
    origin: "akb",
    status: 403,
    code: "permission_denied",
  });

beforeEach(() => {
  vi.clearAllMocks();
  readTarget.mockReturnValue({ appId: "33333333-3333-4333-8333-333333333333" });
  listVaults.mockResolvedValue({ vaults });
  getMe.mockResolvedValue({ profile: { username: "alice", is_admin: false } });
  listMembers.mockResolvedValue({ vaults: [vaults[0]] });
});

describe("personal active workspace discovery", () => {
  it("only inspects active installations for an ordinary user", async () => {
    listMembers.mockResolvedValue({
      vaults: [{ name: "zeta" }, { name: "alpha" }],
    });
    await expect(listActiveWorkspaces({ adapter })).resolves.toEqual([
      "alpha",
      "zeta",
    ]);
    expect(listMembers).toHaveBeenCalledExactlyOnceWith({
      adapter,
      appId: "33333333-3333-4333-8333-333333333333",
    });
    expect(listVaults).not.toHaveBeenCalled();
    expect(listInventory).not.toHaveBeenCalled();
    expect(readActive).not.toHaveBeenCalled();
  });

  it("returns an empty scope without an installation target", async () => {
    readTarget.mockReturnValue(null);
    await expect(listActiveWorkspaces({ adapter })).resolves.toEqual([]);
    expect(getMe).not.toHaveBeenCalled();
    expect(listMembers).not.toHaveBeenCalled();
  });

  it("propagates member list failures without falling back to the directory", async () => {
    const failure = new Error("unavailable");
    listMembers.mockRejectedValue(failure);
    await expect(listActiveWorkspaces({ adapter })).rejects.toBe(failure);
    expect(listVaults).not.toHaveBeenCalled();
    expect(readActive).not.toHaveBeenCalled();
  });

  it("filters all accessible vaults using one authoritative admin inventory read", async () => {
    const manyVaults = Array.from({ length: 191 }, (_, index) => ({
      id: `vault-${index}`,
      name: `vault-${index}`,
      role: "admin",
    }));
    listVaults.mockResolvedValue({ vaults: manyVaults });
    getMe.mockResolvedValue({ profile: { username: "alice", is_admin: true } });
    listInventory.mockResolvedValue(
      manyVaults.slice(0, 27).map((vault) => ({ vaultId: vault.id })),
    );
    const ready = await listActiveWorkspaces({ adapter });
    expect(ready).toEqual(
      Array.from({ length: 27 }, (_, index) => `vault-${index}`).sort(),
    );
    expect(listInventory).toHaveBeenCalledTimes(1);
    expect(readActive).not.toHaveBeenCalled();
  });

  it("propagates a resource denial during ordinary discovery instead of returning partial work", async () => {
    listMembers.mockRejectedValue(denied());
    await expect(listActiveWorkspaces({ adapter })).rejects.toMatchObject({
      context: { status: 403, code: "permission_denied" },
    });
  });

  it("does not fall back to per-vault reads when admin inventory fails", async () => {
    const error = denied();
    getMe.mockResolvedValue({ profile: { is_admin: true } });
    listInventory.mockRejectedValue(error);
    await expect(listActiveWorkspaces({ adapter })).rejects.toBe(error);
    expect(readActive).not.toHaveBeenCalled();
  });

  it("returns an empty scope when the canonical member list is empty", async () => {
    listMembers.mockResolvedValue({ vaults: [] });
    await expect(listActiveWorkspaces({ adapter })).resolves.toEqual([]);
  });

  it.each([
    { status: 401, code: "invalid_session" },
    { status: 403, code: "account_suspended" },
    { status: 403, code: "membership_required" },
    { status: 403, code: "identity_conflict" },
  ])(
    "propagates authoritative account/session denial $code",
    async ({ status, code }) => {
      const error = new AuthError({ origin: "akb", status, code });
      listMembers.mockRejectedValue(error);
      await expect(listActiveWorkspaces({ adapter })).rejects.toBe(error);
    },
  );
});
