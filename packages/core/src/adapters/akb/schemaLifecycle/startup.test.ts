// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchemaLifecycleError } from "../../../errors";
import { createWorkspaceMigrationCatalog } from "./catalog";

const mocks = vi.hoisted(() => ({
  applyMigration: vi.fn(),
  reconcile: vi.fn(),
  verify: vi.fn(),
  readConfig: vi.fn(),
  readMarker: vi.fn(),
  updateMarkerVersion: vi.fn(),
  listMembers: vi.fn(),
  listVaults: vi.fn(),
}));

vi.mock("../core/tables", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../core/tables")>()),
  applyAkbTableMigration: mocks.applyMigration,
  reconcileWorkspaceSchema: mocks.reconcile,
  verifyWorkspaceSchema: mocks.verify,
}));
vi.mock("../workspace/config", () => ({ readConfig: mocks.readConfig }));
vi.mock("../workspace/initializationMarker", () => ({
  readWorkspaceInitializationMarker: mocks.readMarker,
  updateWorkspaceInitializationSchemaVersion: mocks.updateMarkerVersion,
}));
vi.mock("../workspace/vaults", () => ({
  listVaultMembers: mocks.listMembers,
  listVaults: mocks.listVaults,
}));

import { runStartupWorkspaceMigrations } from "./startup";

const config = {
  project_prefix: "REEF",
  monitored_repos: [],
  authoring_language: null,
  stale_hide_completed_days: 28,
  stale_hide_canceled_days: 7,
  ai_scanning_enabled: false,
};

function adapterWithIdentity(
  overrides: {
    profile?: Record<string, unknown>;
    tokens?: Record<string, unknown>[];
  } = {},
) {
  const profile = {
    username: "reef-schema",
    is_admin: false,
    auth_method: "pat",
    key_class: "service",
    ...overrides.profile,
  };
  const tokens = overrides.tokens ?? [
    {
      token_id: "token-1",
      prefix: "secret-value".slice(0, 12),
      scopes: ["read", "write"],
      key_class: "service",
    },
  ];
  return {
    request: vi.fn(async (path: string) => {
      if (path.endsWith("/auth/me")) return profile;
      if (path.endsWith("/auth/tokens")) return { tokens };
      throw new Error(`unexpected request: ${path}`);
    }),
  };
}

function readyInventory(vaults: string[]) {
  mocks.listVaults.mockResolvedValue({
    vaults: vaults.map((name) => ({ name })),
  });
  mocks.listMembers.mockResolvedValue({
    members: [{ username: "reef-schema", role: "writer" }],
  });
  mocks.readMarker.mockImplementation(async (_adapter, vault: string) => ({
    uri: `akb://${vault}/coll/overview/doc/reef-initialization.md`,
    path: "overview/reef-initialization.md",
    currentCommit: "commit",
    marker: {
      schema_version: 1,
      state: "ready",
      request_fingerprint: "f".repeat(64),
    },
  }));
  mocks.readConfig.mockResolvedValue({ exists: true, config });
}

describe("startup workspace migrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyMigration.mockResolvedValue({
      applied: true,
      checksum: "checksum",
    });
    mocks.reconcile.mockResolvedValue(undefined);
    mocks.verify.mockResolvedValue({
      schemaVersion: 1,
      manifestVerified: true,
    });
    mocks.updateMarkerVersion.mockResolvedValue(undefined);
  });

  it.each([
    [{ username: "someone-else" }, undefined],
    [{ is_admin: true }, undefined],
    [{ key_class: "personal" }, undefined],
    [undefined, []],
    [
      undefined,
      [
        {
          token_id: "token-1",
          prefix: "secret-value".slice(0, 12),
          scopes: ["read", "write", "admin"],
          key_class: "service",
        },
      ],
    ],
  ])(
    "rejects a non-strict service identity before inventory",
    async (profile, tokens) => {
      const adapter = adapterWithIdentity({
        profile: profile as Record<string, unknown> | undefined,
        tokens: tokens as Record<string, unknown>[] | undefined,
      });
      await expect(
        runStartupWorkspaceMigrations({
          adapter,
          apiKey: "secret-value",
          serviceUsername: "reef-schema",
        }),
      ).rejects.toBeInstanceOf(SchemaLifecycleError);
      expect(mocks.listVaults).not.toHaveBeenCalled();
    },
  );

  it("finishes full inventory preflight before any mutation", async () => {
    readyInventory(["alpha", "beta"]);
    mocks.readMarker.mockImplementation(async (_adapter, vault: string) =>
      vault === "alpha"
        ? {
            uri: "akb://alpha/coll/overview/doc/reef-initialization.md",
            path: "overview/reef-initialization.md",
            currentCommit: "commit",
            marker: {
              schema_version: 1,
              state: "ready",
              request_fingerprint: "f".repeat(64),
            },
          }
        : null,
    );

    await expect(
      runStartupWorkspaceMigrations({
        adapter: adapterWithIdentity(),
        apiKey: "secret-value",
        serviceUsername: "reef-schema",
      }),
    ).rejects.toBeInstanceOf(SchemaLifecycleError);
    expect(mocks.applyMigration).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("reconciles and verifies registered workspaces in deterministic order with an empty catalog", async () => {
    readyInventory(["zeta", "alpha"]);
    const report = await runStartupWorkspaceMigrations({
      adapter: adapterWithIdentity(),
      apiKey: "secret-value",
      serviceUsername: "reef-schema",
    });

    expect(mocks.applyMigration).not.toHaveBeenCalled();
    expect(mocks.reconcile.mock.calls.map(([arg]) => arg.vault)).toEqual([
      "alpha",
      "zeta",
    ]);
    expect(mocks.verify).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({ workspaceCount: 2, skippedVaultCount: 0 });
  });

  it("stops later workspaces after an intermediate migration failure", async () => {
    readyInventory(["beta", "alpha"]);
    const catalog = createWorkspaceMigrationCatalog(
      [
        {
          fromVersion: 1,
          toVersion: 2,
          phaseId: "11111111-1111-4111-8111-111111111111",
          operations: [
            {
              op: "add_column",
              table: "reef_issues",
              column: { name: "sample", type: "text" },
            },
          ],
        },
      ],
      2,
    );
    mocks.applyMigration.mockRejectedValueOnce(new Error("failed"));

    await expect(
      runStartupWorkspaceMigrations({
        adapter: adapterWithIdentity(),
        apiKey: "secret-value",
        serviceUsername: "reef-schema",
        catalog,
      }),
    ).rejects.toMatchObject({
      context: { reason: "migration_execution_failed", vault: "alpha" },
    });
    expect(mocks.applyMigration).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("applies only the pending catalog suffix and advances durable version state", async () => {
    readyInventory(["current", "older"]);
    mocks.readMarker.mockImplementation(async (_adapter, vault: string) => ({
      uri: `akb://${vault}/coll/overview/doc/reef-initialization.md`,
      path: "overview/reef-initialization.md",
      currentCommit: "commit",
      marker: {
        schema_version: vault === "current" ? 2 : 1,
        state: "ready",
        request_fingerprint: "f".repeat(64),
      },
    }));
    mocks.verify.mockResolvedValue({
      schemaVersion: 2,
      manifestVerified: true,
    });
    const catalog = createWorkspaceMigrationCatalog(
      [
        {
          fromVersion: 1,
          toVersion: 2,
          phaseId: "11111111-1111-4111-8111-111111111111",
          operations: [
            {
              op: "add_column",
              table: "reef_issues",
              column: { name: "sample", type: "text" },
            },
          ],
        },
      ],
      2,
    );

    await runStartupWorkspaceMigrations({
      adapter: adapterWithIdentity(),
      apiKey: "secret-value",
      serviceUsername: "reef-schema",
      catalog,
    });

    expect(mocks.applyMigration).toHaveBeenCalledTimes(1);
    expect(mocks.applyMigration).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "older" }),
    );
    expect(mocks.updateMarkerVersion).toHaveBeenCalledTimes(1);
    expect(mocks.updateMarkerVersion).toHaveBeenCalledWith(
      expect.anything(),
      "older",
      expect.objectContaining({
        marker: expect.objectContaining({ schema_version: 1 }),
      }),
      2,
    );
  });

  it("rejects a workspace version outside the catalog before mutation", async () => {
    readyInventory(["too-old"]);
    mocks.readMarker.mockResolvedValue({
      uri: "akb://too-old/coll/overview/doc/reef-initialization.md",
      path: "overview/reef-initialization.md",
      currentCommit: "commit",
      marker: {
        schema_version: 1,
        state: "ready",
        request_fingerprint: "f".repeat(64),
      },
    });
    const catalog = createWorkspaceMigrationCatalog(
      [
        {
          fromVersion: 2,
          toVersion: 3,
          phaseId: "11111111-1111-4111-8111-111111111111",
          operations: [
            {
              op: "add_column",
              table: "reef_issues",
              column: { name: "sample", type: "text" },
            },
          ],
        },
      ],
      3,
    );

    await expect(
      runStartupWorkspaceMigrations({
        adapter: adapterWithIdentity(),
        apiKey: "secret-value",
        serviceUsername: "reef-schema",
        catalog,
      }),
    ).rejects.toMatchObject({
      context: { reason: "migration_catalog_invalid" },
    });
    expect(mocks.applyMigration).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
});
