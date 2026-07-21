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
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: {
              message: `Authorization: Bearer ${sentinel}`,
              code: sentinel,
            },
          }),
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

  it("keeps the stable missing-table code while discarding an HTTP error body", async () => {
    const sentinel = "REEF_SENTINEL_SUPER_SECRET";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: {
              message: `relation reef_settings does not exist ${sentinel}`,
              code: "undefined_table",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const adapter = createAkbServiceAdapter({
      baseUrl: "https://akb.test",
      serviceKey: sentinel,
    });

    await expect(
      akbReadReefSchemaVersion({ adapter, vault: "greenfield" }),
    ).resolves.toBe(0);
  });

  it("normalizes a legacy missing-table SQL envelope without retaining its text", async () => {
    const sentinel = "REEF_SENTINEL_SUPER_SECRET";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          error: `relation reef_settings does not exist ${sentinel}`,
        }),
      }),
    );
    const adapter = createAkbServiceAdapter({
      baseUrl: "https://akb.test",
      serviceKey: sentinel,
    });

    await expect(
      akbReadReefSchemaVersion({ adapter, vault: "greenfield" }),
    ).resolves.toBe(0);
  });

  it("sanitizes legacy HTTP 200 SQL error envelopes and network throwables", async () => {
    const sentinel = "REEF_SENTINEL_SUPER_SECRET";
    const adapter = createAkbServiceAdapter({
      baseUrl: "https://akb.test",
      serviceKey: sentinel,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            error: `proxy echoed ${sentinel}`,
            code: sentinel,
          }),
        })
        .mockRejectedValueOnce(new Error(`network echoed ${sentinel}`)),
    );

    for (const operation of [
      () => akbReadReefSchemaVersion({ adapter, vault: "reef-a" }),
      () => adapter.request("/api/v1/my/vaults"),
    ]) {
      let thrown: unknown;
      try {
        await operation();
      } catch (error) {
        thrown = error;
      }
      expect(String(thrown)).not.toContain(sentinel);
      expect(JSON.stringify(thrown)).not.toContain(sentinel);
    }
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
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        members: [{ username: "reef-migrator", role: "writer" }],
      })
      .mockResolvedValueOnce({
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

  it("does not restore over a newer direct membership change", async () => {
    const request = vi.fn().mockResolvedValue({
      members: [{ username: "reef-migrator", role: "admin" }],
    });

    await akbRestoreVaultMigrationWriter({
      adapter: { request },
      vault: "reef-a",
      username: "reef-migrator",
      previousRole: null,
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "/api/v1/vaults/reef-a/members",
      expect.anything(),
    );
  });

  it("still attempts compensation when the defensive role read fails", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("member read unavailable"))
      .mockResolvedValueOnce({ revoked: true });

    await akbRestoreVaultMigrationWriter({
      adapter: { request },
      vault: "reef-a",
      username: "reef-migrator",
      previousRole: null,
    });

    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/vaults/reef-a/members",
      "/api/v1/vaults/reef-a/revoke",
    ]);
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
      "/api/v1/vaults/reef-a/members",
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
        members: [{ username: "reef-migrator", role: "writer" }],
      })
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
