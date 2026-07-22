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

  it("stops later workspaces after an intermediate migration failure", async () => {
    inventory(["beta", "alpha"]);
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
});
