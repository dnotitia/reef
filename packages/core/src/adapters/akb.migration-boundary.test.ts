import { afterEach, describe, expect, it, vi } from "vitest";
import {
  akbReadReefSchemaVersion,
  akbRegisterVaultMigrationWriter,
  akbRestoreVaultMigrationWriter,
  createAkbServiceAdapter,
} from "../index";

describe("migration service adapter boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replaces upstream credential-bearing error text before it reaches a throwable", async () => {
    const sentinel = "REEF_SENTINEL_SUPER_SECRET";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ detail: `Authorization: Bearer ${sentinel}` }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          ),
        ),
    );
    const adapter = createAkbServiceAdapter({
      baseUrl: "https://akb.test",
      serviceKey: sentinel,
    });

    let thrown: unknown;
    try {
      await adapter.request("/api/v1/my/vaults");
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).not.toContain(sentinel);
    expect(JSON.stringify(thrown)).not.toContain(sentinel);
  });

  it("registers the service account as writer and confirms exact readback", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ members: [] })
      .mockResolvedValueOnce({
        vault: "reef-a",
        user: "reef-migrator",
        role: "writer",
      })
      .mockResolvedValueOnce({
        members: [{ username: "reef-migrator", role: "writer" }],
      });

    await expect(
      akbRegisterVaultMigrationWriter({
        adapter: { request },
        vault: "reef-a",
        username: "reef-migrator",
      }),
    ).resolves.toEqual({ previousRole: null });

    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/vaults/reef-a/members",
      "/api/v1/vaults/reef-a/grant",
      "/api/v1/vaults/reef-a/members",
    ]);
  });

  it("restores the prior migration membership after initialization failure", async () => {
    const request = vi.fn().mockResolvedValue({
      vault: "reef-a",
      user: "reef-migrator",
      role: "reader",
    });

    await akbRestoreVaultMigrationWriter({
      adapter: { request },
      vault: "reef-a",
      username: "reef-migrator",
      previousRole: "reader",
    });

    expect(request).toHaveBeenCalledWith(
      "/api/v1/vaults/reef-a/grant",
      expect.objectContaining({
        body: { user: "reef-migrator", role: "reader" },
      }),
    );
  });

  it("fails registration when writer membership readback does not match", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ members: [] })
      .mockResolvedValueOnce({
        vault: "reef-a",
        user: "reef-migrator",
        role: "writer",
      })
      .mockResolvedValueOnce({
        members: [{ username: "reef-migrator", role: "reader" }],
      });
    await expect(
      akbRegisterVaultMigrationWriter({
        adapter: { request },
        vault: "reef-a",
        username: "reef-migrator",
      }),
    ).rejects.toThrow("Invalid data");
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/vaults/reef-a/members",
      "/api/v1/vaults/reef-a/grant",
      "/api/v1/vaults/reef-a/members",
      "/api/v1/vaults/reef-a/revoke",
    ]);
  });

  it("restores prior membership when writer readback throws after grant", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        members: [{ username: "reef-migrator", role: "reader" }],
      })
      .mockResolvedValueOnce({
        vault: "reef-a",
        user: "reef-migrator",
        role: "writer",
      })
      .mockRejectedValueOnce(new Error("readback unavailable"))
      .mockResolvedValueOnce({
        vault: "reef-a",
        user: "reef-migrator",
        role: "reader",
      });

    await expect(
      akbRegisterVaultMigrationWriter({
        adapter: { request },
        vault: "reef-a",
        username: "reef-migrator",
      }),
    ).rejects.toThrow("readback unavailable");
    expect(request).toHaveBeenLastCalledWith(
      "/api/v1/vaults/reef-a/grant",
      expect.objectContaining({
        body: { user: "reef-migrator", role: "reader" },
      }),
    );
  });

  it("reads the stored Reef schema version through the public adapter boundary", async () => {
    const request = vi.fn().mockResolvedValue({
      kind: "table_query",
      columns: ["value"],
      items: [{ value: '{"version":1}' }],
      total: 1,
    });
    await expect(
      akbReadReefSchemaVersion({ adapter: { request }, vault: "reef-a" }),
    ).resolves.toBe(1);
    expect(request).toHaveBeenCalledWith(
      "/api/v1/tables/reef-a/sql",
      expect.anything(),
    );
  });
});
