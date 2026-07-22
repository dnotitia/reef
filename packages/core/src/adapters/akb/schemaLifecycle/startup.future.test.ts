// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../core/tableManifest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../core/tableManifest")>()),
  REEF_SCHEMA_VERSION: 2,
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

import { createWorkspaceMigrationCatalog } from "./catalog";
import { runStartupWorkspaceMigrations } from "./startup";

const catalog = createWorkspaceMigrationCatalog([
  {
    kind: "operations",
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
]);

const reconcileOnlyCatalog = createWorkspaceMigrationCatalog([
  {
    kind: "reconcile_only",
    fromVersion: 1,
    toVersion: 2,
    phaseId: "22222222-2222-4222-8222-222222222222",
    manifests: [
      {
        name: "reef_new_table",
        columns: [{ name: "value", type: "text" }],
      },
    ],
  },
]);

const catchUpCatalog = createWorkspaceMigrationCatalog([
  {
    kind: "reconcile_only",
    fromVersion: 0,
    toVersion: 1,
    phaseId: "33333333-3333-4333-8333-333333333333",
    manifests: [
      {
        name: "reef_new_table",
        columns: [{ name: "value", type: "text" }],
      },
    ],
  },
  {
    kind: "operations",
    fromVersion: 1,
    toVersion: 2,
    phaseId: "44444444-4444-4444-8444-444444444444",
    operations: [
      {
        op: "add_column",
        table: "reef_new_table",
        column: { name: "sample", type: "text" },
      },
    ],
  },
]);

function adapterWithIdentity() {
  return {
    request: vi.fn(async (path: string) => {
      if (path.endsWith("/auth/me")) {
        return {
          username: "reef-schema",
          is_admin: false,
          auth_method: "pat",
          key_class: "service",
        };
      }
      if (path.endsWith("/auth/tokens")) {
        return {
          tokens: [
            {
              token_id: "token-1",
              prefix: "secret-value".slice(0, 12),
              scopes: ["read", "write"],
              key_class: "service",
            },
          ],
        };
      }
      throw new Error(`unexpected request: ${path}`);
    }),
  };
}

function inventory(vaults: string[]): void {
  mocks.listVaults.mockResolvedValue({
    vaults: vaults.map((name) => ({ name })),
  });
  mocks.listMembers.mockResolvedValue({
    members: [{ username: "reef-schema", role: "writer" }],
  });
  mocks.readConfig.mockResolvedValue({
    exists: true,
    config: {
      project_prefix: "REEF",
      monitored_repos: [],
      authoring_language: null,
      stale_hide_completed_days: 28,
      stale_hide_canceled_days: 7,
      ai_scanning_enabled: false,
    },
  });
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
}

describe("startup migrations for a future release catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyMigration.mockResolvedValue({
      applied: true,
      checksum: "checksum",
    });
    mocks.verify.mockResolvedValue({
      schemaVersion: 2,
      manifestVerified: true,
    });
  });

  it("applies only the pending suffix and advances durable version state", async () => {
    inventory(["current", "older"]);

    await runStartupWorkspaceMigrations({
      adapter: adapterWithIdentity(),
      apiKey: "secret-value",
      serviceUsername: "reef-schema",
      expectedWorkspaces: ["current", "older"],
      catalog,
    });

    expect(mocks.applyMigration).toHaveBeenCalledTimes(1);
    expect(mocks.applyMigration).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "older" }),
    );
    expect(mocks.updateMarkerVersion).toHaveBeenCalledWith(
      expect.anything(),
      "older",
      expect.objectContaining({
        marker: expect.objectContaining({ schema_version: 1 }),
      }),
      2,
    );
  });

  it("advances a manifest-only version through reconcile without a table migration operation", async () => {
    inventory(["older"]);

    const report = await runStartupWorkspaceMigrations({
      adapter: adapterWithIdentity(),
      apiKey: "secret-value",
      serviceUsername: "reef-schema",
      expectedWorkspaces: ["older"],
      catalog: reconcileOnlyCatalog,
    });

    expect(mocks.applyMigration).not.toHaveBeenCalled();
    expect(mocks.reconcile).toHaveBeenCalledWith({
      adapter: expect.anything(),
      vault: "older",
      desiredTables: [
        {
          name: "reef_new_table",
          columns: [{ name: "value", type: "text" }],
        },
      ],
      schemaVersion: 2,
      allowAdditionalColumns: true,
    });
    expect(mocks.verify).toHaveBeenCalledWith({
      adapter: expect.anything(),
      vault: "older",
    });
    expect(mocks.updateMarkerVersion).toHaveBeenCalledWith(
      expect.anything(),
      "older",
      expect.objectContaining({
        marker: expect.objectContaining({ schema_version: 1 }),
      }),
      2,
    );
    expect(report.workspaces).toEqual([
      {
        vault: "older",
        appliedPhases: 0,
        replayedPhases: 0,
        checksums: [],
      },
    ]);
  });

  it("reconciles at catalog order before a later operation uses the new manifest", async () => {
    inventory(["older"]);
    mocks.readMarker.mockResolvedValue({
      uri: "akb://older/coll/overview/doc/reef-initialization.md",
      path: "overview/reef-initialization.md",
      currentCommit: "commit",
      marker: {
        schema_version: 0,
        state: "ready",
        request_fingerprint: "f".repeat(64),
      },
    });

    await runStartupWorkspaceMigrations({
      adapter: adapterWithIdentity(),
      apiKey: "secret-value",
      serviceUsername: "reef-schema",
      expectedWorkspaces: ["older"],
      catalog: catchUpCatalog,
    });

    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
    expect(mocks.applyMigration).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.applyMigration.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.applyMigration.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.reconcile.mock.invocationCallOrder[1] ?? 0,
    );
  });

  it("stops later workspaces after an intermediate migration failure", async () => {
    inventory(["beta", "alpha"]);
    mocks.applyMigration.mockRejectedValueOnce(new Error("failed"));

    await expect(
      runStartupWorkspaceMigrations({
        adapter: adapterWithIdentity(),
        apiKey: "secret-value",
        serviceUsername: "reef-schema",
        expectedWorkspaces: ["alpha", "beta"],
        catalog,
      }),
    ).rejects.toMatchObject({
      context: { reason: "migration_execution_failed", vault: "alpha" },
    });
    expect(mocks.applyMigration).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
});
