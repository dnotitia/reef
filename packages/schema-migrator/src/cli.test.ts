// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdapter: vi.fn(),
  runMigrations: vi.fn(),
}));

vi.mock("@reef/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@reef/core")>()),
  createAkbAdapter: mocks.createAdapter,
  runStartupWorkspaceMigrations: mocks.runMigrations,
}));

import { SchemaLifecycleError } from "@reef/core";
import {
  projectPublicMigrationError,
  projectPublicMigrationReport,
  runCli,
} from "./cli";

describe("schema migrator public projection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("projects a bounded report without internal or credential sentinels", () => {
    const sentinel = "DO_NOT_LEAK_SECRET";
    const projected = projectPublicMigrationReport({
      status: "completed",
      workspaceCount: 1,
      skippedVaultCount: 2,
      workspaces: [
        {
          vault: "reef-sample",
          appliedPhases: 1,
          replayedPhases: 0,
          checksums: ["safe-checksum"],
          internal: sentinel,
        },
      ],
      internal: sentinel,
    } as never);

    expect(projected).toEqual({
      status: "completed",
      workspace_count: 1,
      skipped_vault_count: 2,
      workspaces: [
        {
          vault: "reef-sample",
          applied_phases: 1,
          replayed_phases: 0,
          checksums: ["safe-checksum"],
        },
      ],
    });
    expect(JSON.stringify(projected)).not.toContain(sentinel);
  });

  it("projects only bounded lifecycle error fields", () => {
    const error = new SchemaLifecycleError({
      reason: "migration_execution_failed",
      vault: "reef-sample",
      phaseId: "11111111-1111-4111-8111-111111111111",
    });
    Object.assign(error, { upstreamBody: "DO_NOT_LEAK_SECRET" });

    const projected = projectPublicMigrationError(error);
    expect(projected).toEqual({
      code: "migration_execution_failed",
      vault: "reef-sample",
      phase_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(JSON.stringify(projected)).not.toContain("DO_NOT_LEAK_SECRET");
    expect(
      projectPublicMigrationError(new Error("DO_NOT_LEAK_SECRET")),
    ).toEqual({ code: "schema_migration_failed" });
  });

  it("keeps the secret internal while returning only the public report", async () => {
    const adapter = { request: vi.fn() };
    mocks.createAdapter.mockReturnValue(adapter);
    mocks.runMigrations.mockResolvedValue({
      status: "completed",
      workspaceCount: 0,
      skippedVaultCount: 0,
      workspaces: [],
    });

    const result = await runCli({
      AKB_BACKEND_URL: "https://akb.example",
      REEF_SCHEMA_MIGRATION_KEY: "DO_NOT_LEAK_SECRET",
      REEF_SCHEMA_SERVICE_USERNAME: "reef-schema",
      REEF_SCHEMA_EXPECTED_WORKSPACES: '["reef-alpha"]',
    });

    expect(mocks.createAdapter).toHaveBeenCalledWith({
      baseUrl: "https://akb.example",
      jwt: "DO_NOT_LEAK_SECRET",
    });
    expect(mocks.runMigrations).toHaveBeenCalledWith({
      adapter,
      apiKey: "DO_NOT_LEAK_SECRET",
      serviceUsername: "reef-schema",
      expectedWorkspaces: ["reef-alpha"],
    });
    expect(JSON.stringify(result)).not.toContain("DO_NOT_LEAK_SECRET");
  });

  it("passes opaque credential whitespace through unchanged", async () => {
    const adapter = { request: vi.fn() };
    mocks.createAdapter.mockReturnValue(adapter);
    mocks.runMigrations.mockResolvedValue({
      status: "completed",
      workspaceCount: 0,
      skippedVaultCount: 0,
      workspaces: [],
    });
    const apiKey = "  opaque-service-token  ";

    await runCli({
      AKB_BACKEND_URL: "https://akb.example",
      REEF_SCHEMA_MIGRATION_KEY: apiKey,
      REEF_SCHEMA_SERVICE_USERNAME: "reef-schema",
      REEF_SCHEMA_EXPECTED_WORKSPACES: "[]",
    });

    expect(mocks.createAdapter).toHaveBeenCalledWith({
      baseUrl: "https://akb.example",
      jwt: apiKey,
    });
    expect(mocks.runMigrations).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey }),
    );
  });

  it("fails closed when any required deployment configuration is absent", async () => {
    await expect(
      runCli({ AKB_BACKEND_URL: "https://akb.example" }),
    ).rejects.toMatchObject({
      context: { reason: "migration_config_invalid" },
    });
    expect(mocks.createAdapter).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "not-json",
    "{}",
    '["", "reef-alpha"]',
    '["reef-alpha", "reef-alpha"]',
  ])(
    "rejects an invalid authoritative workspace inventory",
    async (inventory) => {
      await expect(
        runCli({
          AKB_BACKEND_URL: "https://akb.example",
          REEF_SCHEMA_MIGRATION_KEY: "secret-value",
          REEF_SCHEMA_SERVICE_USERNAME: "reef-schema",
          REEF_SCHEMA_EXPECTED_WORKSPACES: inventory,
        }),
      ).rejects.toMatchObject({
        context: { reason: "migration_config_invalid" },
      });
      expect(mocks.createAdapter).not.toHaveBeenCalled();
    },
  );
});
