import {
  type AkbTableMigrationOperation,
  REEF_SCHEMA_VERSION,
  akbApplyTableMigration,
  akbEnsureReefTables,
  akbGetMe,
  akbListVaultMembers,
  akbListVaults,
  akbReadConfig,
  akbReadReefSchemaVersion,
  createAkbServiceAdapter,
} from "@reef/core";
import {
  type MigrationPhase,
  REEF_MIGRATION_CATALOG,
  pendingMigrationPhases,
} from "./catalog.js";
import type { MigrationConfig } from "./config.js";

export type MigrationErrorCode =
  | "identity_invalid"
  | "inventory_failed"
  | "preflight_failed"
  | "migration_failed"
  | "verification_failed";

export interface WorkspaceMigrationResult {
  vault: string;
  status: "applied" | "no_op";
  phases: Array<{
    phaseId: string;
    applied: boolean;
    checksum: string;
  }>;
}

export interface MigrationReport {
  ok: boolean;
  code: "ok" | MigrationErrorCode;
  targetVersion: number;
  counts: {
    discovered: number;
    reef: number;
    rawSkipped: number;
    completed: number;
  };
  workspaces: WorkspaceMigrationResult[];
  failure?: { vault?: string; phaseId?: string };
}

export interface MigrationRuntime {
  getIdentity(): Promise<{
    username?: string;
    isAdmin?: boolean;
    keyClass?: string;
  }>;
  listVaults(): Promise<Array<{ name: string }>>;
  inspectWorkspace(vault: string): Promise<{
    isReef: boolean;
    members: Array<{ username: string; role: string }>;
  }>;
  readSchemaVersion(vault: string): Promise<number>;
  applyPhase(
    vault: string,
    phaseId: string,
    operations: readonly AkbTableMigrationOperation[],
  ): Promise<{ applied: boolean; checksum: string }>;
  ensureTables(vault: string): Promise<void>;
}

export class MigrationRunError extends Error {
  constructor(readonly report: MigrationReport) {
    super(report.code);
    this.name = "MigrationRunError";
  }
}

const failedReport = (
  code: MigrationErrorCode,
  counts: MigrationReport["counts"],
  workspaces: WorkspaceMigrationResult[],
  failure?: MigrationReport["failure"],
): MigrationReport => ({
  ok: false,
  code,
  targetVersion: REEF_SCHEMA_VERSION,
  counts,
  workspaces,
  ...(failure ? { failure } : {}),
});

export function createCoreMigrationRuntime(
  config: MigrationConfig,
): MigrationRuntime {
  const adapter = createAkbServiceAdapter({
    baseUrl: config.akbBaseUrl,
    serviceKey: config.serviceKey,
  });
  return {
    async getIdentity() {
      const { profile } = await akbGetMe({ adapter });
      return {
        username: profile.username,
        isAdmin: profile.is_admin,
        keyClass: profile.key_class,
      };
    },
    async listVaults() {
      return (await akbListVaults({ adapter })).vaults;
    },
    async inspectWorkspace(vault) {
      const [configResult, membersResult] = await Promise.all([
        akbReadConfig({ adapter, vault }),
        akbListVaultMembers({ adapter, vault }),
      ]);
      return { isReef: configResult.exists, members: membersResult.members };
    },
    readSchemaVersion: (vault) => akbReadReefSchemaVersion({ adapter, vault }),
    async applyPhase(vault, phaseId, operations) {
      const result = await akbApplyTableMigration({
        adapter,
        vault,
        idempotencyKey: phaseId,
        operations: operations.map((operation) => structuredClone(operation)),
      });
      return { applied: result.applied, checksum: result.checksum };
    },
    ensureTables: (vault) => akbEnsureReefTables({ adapter, vault }),
  };
}

export async function runSchemaMigrations({
  runtime,
  serviceAccount,
  catalog = REEF_MIGRATION_CATALOG,
}: {
  runtime: MigrationRuntime;
  serviceAccount: string;
  catalog?: readonly MigrationPhase[];
}): Promise<MigrationReport> {
  const counts = { discovered: 0, reef: 0, rawSkipped: 0, completed: 0 };
  const completed: WorkspaceMigrationResult[] = [];
  let identity: Awaited<ReturnType<MigrationRuntime["getIdentity"]>>;
  try {
    identity = await runtime.getIdentity();
  } catch {
    throw new MigrationRunError(
      failedReport("identity_invalid", counts, completed),
    );
  }
  if (
    identity.username !== serviceAccount ||
    identity.isAdmin !== false ||
    identity.keyClass !== "service"
  ) {
    throw new MigrationRunError(
      failedReport("identity_invalid", counts, completed),
    );
  }

  let vaults: Array<{ name: string }>;
  try {
    vaults = [...(await runtime.listVaults())].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    throw new MigrationRunError(
      failedReport("inventory_failed", counts, completed),
    );
  }
  counts.discovered = vaults.length;

  let inspections: Array<{
    vault: string;
    isReef: boolean;
    members: Array<{ username: string; role: string }>;
  }>;
  try {
    inspections = await Promise.all(
      vaults.map(async ({ name }) => ({
        vault: name,
        ...(await runtime.inspectWorkspace(name)),
      })),
    );
  } catch {
    throw new MigrationRunError(
      failedReport("preflight_failed", counts, completed),
    );
  }

  const reefWorkspaces = inspections.filter(({ isReef }) => isReef);
  counts.reef = reefWorkspaces.length;
  counts.rawSkipped = inspections.length - reefWorkspaces.length;
  for (const workspace of reefWorkspaces) {
    const exactMembership = workspace.members.find(
      (member) => member.username === serviceAccount,
    );
    if (exactMembership?.role !== "writer") {
      throw new MigrationRunError(
        failedReport("preflight_failed", counts, completed, {
          vault: workspace.vault,
        }),
      );
    }
  }

  for (const workspace of reefWorkspaces) {
    const workspaceResult: WorkspaceMigrationResult = {
      vault: workspace.vault,
      status: "no_op",
      phases: [],
    };
    let phases: readonly MigrationPhase[];
    try {
      const currentVersion = await runtime.readSchemaVersion(workspace.vault);
      phases = pendingMigrationPhases(
        currentVersion,
        REEF_SCHEMA_VERSION,
        catalog,
      );
    } catch {
      throw new MigrationRunError(
        failedReport("migration_failed", counts, completed, {
          vault: workspace.vault,
        }),
      );
    }
    for (const phase of phases) {
      try {
        const result = await runtime.applyPhase(
          workspace.vault,
          phase.idempotencyKey,
          phase.operations,
        );
        workspaceResult.phases.push({
          phaseId: phase.idempotencyKey,
          applied: result.applied,
          checksum: result.checksum,
        });
        if (result.applied) workspaceResult.status = "applied";
      } catch {
        throw new MigrationRunError(
          failedReport("migration_failed", counts, completed, {
            vault: workspace.vault,
            phaseId: phase.idempotencyKey,
          }),
        );
      }
    }
    try {
      await runtime.ensureTables(workspace.vault);
    } catch {
      throw new MigrationRunError(
        failedReport("verification_failed", counts, completed, {
          vault: workspace.vault,
        }),
      );
    }
    completed.push(workspaceResult);
    counts.completed += 1;
  }

  return {
    ok: true,
    code: "ok",
    targetVersion: REEF_SCHEMA_VERSION,
    counts,
    workspaces: completed,
  };
}
