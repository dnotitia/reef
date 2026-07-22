import { z } from "zod";
import { SchemaLifecycleError } from "../../../errors";
import type { AkbAdapter } from "../core/http";
import { REEF_SCHEMA_VERSION } from "../core/tableManifest";
import {
  applyAkbTableMigration,
  reconcileWorkspaceSchema,
  verifyWorkspaceSchema,
} from "../core/tables";
import { readConfig } from "../workspace/config";
import {
  type StoredWorkspaceInitializationMarker,
  readWorkspaceInitializationMarker,
  updateWorkspaceInitializationSchemaVersion,
} from "../workspace/initializationMarker";
import { listVaultMembers, listVaults } from "../workspace/vaults";
import {
  WORKSPACE_MIGRATION_CATALOG,
  type WorkspaceMigrationCatalog,
} from "./catalog";

const MigrationIdentitySchema = z
  .object({
    username: z.string().min(1),
    is_admin: z.boolean(),
    auth_method: z.literal("pat"),
    key_class: z.literal("service"),
  })
  .passthrough();

const MigrationTokenSchema = z
  .object({
    token_id: z.string().min(1),
    prefix: z.string().min(1),
    scopes: z.array(z.string()),
    key_class: z.literal("service"),
  })
  .passthrough();

const MigrationTokenListSchema = z.object({
  tokens: z.array(MigrationTokenSchema),
});

export interface StartupMigrationWorkspaceReport {
  vault: string;
  appliedPhases: number;
  replayedPhases: number;
  checksums: string[];
}

export interface StartupMigrationOperatorReport {
  status: "completed";
  workspaceCount: number;
  skippedVaultCount: number;
  workspaces: StartupMigrationWorkspaceReport[];
}

interface RegisteredWorkspace {
  vault: string;
  marker: StoredWorkspaceInitializationMarker;
}

function scopesAreExactReadWrite(scopes: readonly string[]): boolean {
  return (
    scopes.length === 2 && scopes.includes("read") && scopes.includes("write")
  );
}

async function preflightIdentity(
  adapter: AkbAdapter,
  apiKey: string,
  expectedUsername: string,
): Promise<void> {
  const profile = MigrationIdentitySchema.safeParse(
    await adapter.request("/api/v1/auth/me", {
      resource: "migration identity",
    }),
  );
  if (
    !profile.success ||
    profile.data.username !== expectedUsername ||
    profile.data.is_admin
  ) {
    throw new SchemaLifecycleError({ reason: "migration_identity_invalid" });
  }
  const tokenList = MigrationTokenListSchema.safeParse(
    await adapter.request("/api/v1/auth/tokens", {
      resource: "migration identity tokens",
    }),
  );
  if (!tokenList.success) {
    throw new SchemaLifecycleError({ reason: "migration_identity_invalid" });
  }
  const prefix = apiKey.slice(0, 12);
  const matches = tokenList.data.tokens.filter(
    (token) => token.prefix === prefix,
  );
  if (
    matches.length !== 1 ||
    !matches[0] ||
    !scopesAreExactReadWrite(matches[0].scopes)
  ) {
    throw new SchemaLifecycleError({ reason: "migration_identity_invalid" });
  }
}

async function preflightInventory(
  adapter: AkbAdapter,
  serviceUsername: string,
): Promise<{ registered: RegisteredWorkspace[]; skipped: number }> {
  const { vaults } = await listVaults({ adapter });
  const registered: RegisteredWorkspace[] = [];
  let skipped = 0;

  for (const vault of [...vaults].sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const [{ members }, marker] = await Promise.all([
      listVaultMembers({ adapter, vault: vault.name }),
      readWorkspaceInitializationMarker(adapter, vault.name),
    ]);
    const serviceMembers = members.filter(
      (member) => member.username === serviceUsername,
    );
    const exactWriter =
      serviceMembers.length === 1 && serviceMembers[0]?.role === "writer";

    if (!marker && serviceMembers.length === 0) {
      skipped += 1;
      continue;
    }
    if (!marker || !exactWriter || marker.marker.state !== "ready") {
      throw new SchemaLifecycleError({
        reason: "migration_inventory_invalid",
        vault: vault.name,
      });
    }
    const config = await readConfig({ adapter, vault: vault.name });
    if (!config.exists) {
      throw new SchemaLifecycleError({
        reason: "migration_inventory_invalid",
        vault: vault.name,
      });
    }
    registered.push({ vault: vault.name, marker });
  }
  return { registered, skipped };
}

function pendingEntries(
  catalog: WorkspaceMigrationCatalog,
  currentVersion: number,
) {
  if (currentVersion === catalog.targetVersion) return [];
  if (currentVersion > catalog.targetVersion) {
    throw new SchemaLifecycleError({ reason: "migration_catalog_invalid" });
  }
  const start = catalog.entries.findIndex(
    (entry) => entry.fromVersion === currentVersion,
  );
  if (start < 0) {
    throw new SchemaLifecycleError({ reason: "migration_catalog_invalid" });
  }
  const pending = catalog.entries.slice(start);
  if (pending.at(-1)?.toVersion !== catalog.targetVersion) {
    throw new SchemaLifecycleError({ reason: "migration_catalog_invalid" });
  }
  return pending;
}

export interface RunStartupWorkspaceMigrationsParams {
  adapter: AkbAdapter;
  apiKey: string;
  serviceUsername: string;
  catalog?: WorkspaceMigrationCatalog;
}

/** Explicit schema lifecycle owner for release startup migration. */
export async function runStartupWorkspaceMigrations(
  params: RunStartupWorkspaceMigrationsParams,
): Promise<StartupMigrationOperatorReport> {
  const apiKey = params.apiKey;
  const serviceUsername = params.serviceUsername.trim();
  if (!apiKey.trim() || !serviceUsername) {
    throw new SchemaLifecycleError({ reason: "migration_config_invalid" });
  }
  const catalog = params.catalog ?? WORKSPACE_MIGRATION_CATALOG;
  // Reconciliation and final verification are compiled against this release's
  // manifest. Refuse a foreign/future catalog before even inventory reads, so
  // no operation can mutate a workspace into a schema this binary cannot use.
  if (catalog.targetVersion !== REEF_SCHEMA_VERSION) {
    throw new SchemaLifecycleError({ reason: "migration_catalog_invalid" });
  }
  await preflightIdentity(params.adapter, apiKey, serviceUsername);
  const inventory = await preflightInventory(params.adapter, serviceUsername);
  const planned = inventory.registered.map((workspace) => ({
    ...workspace,
    pending: pendingEntries(catalog, workspace.marker.marker.schema_version),
  }));

  const workspaces: StartupMigrationWorkspaceReport[] = [];
  for (const workspace of planned) {
    const report: StartupMigrationWorkspaceReport = {
      vault: workspace.vault,
      appliedPhases: 0,
      replayedPhases: 0,
      checksums: [],
    };
    for (const entry of workspace.pending) {
      // A manifest-only version step has no AKB ALTER operation. Its durable
      // effect starts with reconciliation at this exact catalog position. That
      // ordering matters when a later phase alters a table introduced here.
      if (entry.kind === "reconcile_only") {
        try {
          await reconcileWorkspaceSchema({
            adapter: params.adapter,
            vault: workspace.vault,
            desiredTables: entry.manifests,
            schemaVersion: entry.toVersion,
            allowAdditionalColumns: true,
          });
        } catch {
          throw new SchemaLifecycleError({
            reason: "migration_execution_failed",
            vault: workspace.vault,
            phaseId: entry.phaseId,
          });
        }
        continue;
      }
      try {
        const result = await applyAkbTableMigration({
          adapter: params.adapter,
          vault: workspace.vault,
          idempotencyKey: entry.phaseId,
          operations: [...entry.operations],
        });
        report.checksums.push(result.checksum);
        if (result.applied) report.appliedPhases += 1;
        else report.replayedPhases += 1;
      } catch {
        throw new SchemaLifecycleError({
          reason: "migration_execution_failed",
          vault: workspace.vault,
          phaseId: entry.phaseId,
        });
      }
    }
    try {
      await reconcileWorkspaceSchema({
        adapter: params.adapter,
        vault: workspace.vault,
      });
      const verification = await verifyWorkspaceSchema({
        adapter: params.adapter,
        vault: workspace.vault,
      });
      if (
        !verification.manifestVerified ||
        verification.schemaVersion !== catalog.targetVersion
      ) {
        throw new SchemaLifecycleError({
          reason: "schema_mismatch",
          vault: workspace.vault,
        });
      }
      if (workspace.marker.marker.schema_version < catalog.targetVersion) {
        await updateWorkspaceInitializationSchemaVersion(
          params.adapter,
          workspace.vault,
          workspace.marker,
          catalog.targetVersion,
        );
      }
    } catch (error) {
      if (error instanceof SchemaLifecycleError) throw error;
      throw new SchemaLifecycleError({
        reason: "migration_execution_failed",
        vault: workspace.vault,
      });
    }
    workspaces.push(report);
  }

  return {
    status: "completed",
    workspaceCount: workspaces.length,
    skippedVaultCount: inventory.skipped,
    workspaces,
  };
}
