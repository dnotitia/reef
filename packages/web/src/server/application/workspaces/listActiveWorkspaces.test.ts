import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, type AkbAdapter } from "@reef/core";

const { listVaults, getMe, listInventory, readActive } = vi.hoisted(() => ({
  listVaults: vi.fn(),
  getMe: vi.fn(),
  listInventory: vi.fn(),
  readActive: vi.fn(),
}));
vi.mock("@reef/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@reef/core")>()),
  akbListVaults: listVaults,
  akbGetMe: getMe,
  akbListAdminActiveInstallations: listInventory,
}));
vi.mock("@/server/adapters/workspaceInstallation", () => ({
  readWorkspaceInstallationActive: readActive,
}));
vi.mock("@/server/adapters/installationTarget", () => ({
  readInstallationTarget: () => ({
    appId: "33333333-3333-4333-8333-333333333333",
  }),
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
  listVaults.mockResolvedValue({ vaults });
  getMe.mockResolvedValue({ profile: { username: "alice", is_admin: false } });
  readActive.mockImplementation(async ({ vault }) => {
    return vault.id === "active";
  });
});

describe("personal active workspace discovery", () => {
  it("only inspects active installations for an ordinary user", async () => {
    await expect(listActiveWorkspaces({ adapter })).resolves.toEqual([
      "reef-test",
    ]);
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
    readActive.mockRejectedValue(denied());
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

  it("skips unknown availability without inspecting workspace tables or initialization", async () => {
    readActive.mockResolvedValue(null);
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
      readActive.mockRejectedValue(error);
      await expect(listActiveWorkspaces({ adapter })).rejects.toBe(error);
    },
  );
});
