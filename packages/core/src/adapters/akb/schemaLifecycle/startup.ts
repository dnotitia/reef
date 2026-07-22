import { z } from "zod";
import { SchemaLifecycleError } from "../../../errors";
import type { AkbAdapter } from "../core/http";
import {
  applyAkbTableMigration,
  reconcileWorkspaceSchema,
  verifyWorkspaceSchema,
} from "../core/tables";
import { readConfig } from "../workspace/config";
import { readWorkspaceInitializationMarker } from "../workspace/initializationMarker";
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

    if (!marker && !exactWriter) {
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
    registered.push({ vault: vault.name });
  }
  return { registered, skipped };
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
  const apiKey = params.apiKey.trim();
  const serviceUsername = params.serviceUsername.trim();
  if (!apiKey || !serviceUsername) {
    throw new SchemaLifecycleError({ reason: "migration_config_invalid" });
  }
  const catalog = params.catalog ?? WORKSPACE_MIGRATION_CATALOG;
  await preflightIdentity(params.adapter, apiKey, serviceUsername);
  const inventory = await preflightInventory(params.adapter, serviceUsername);

  const workspaces: StartupMigrationWorkspaceReport[] = [];
  for (const workspace of inventory.registered) {
    const report: StartupMigrationWorkspaceReport = {
      vault: workspace.vault,
      appliedPhases: 0,
      replayedPhases: 0,
      checksums: [],
    };
    for (const entry of catalog.entries) {
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
      await verifyWorkspaceSchema({
        adapter: params.adapter,
        vault: workspace.vault,
      });
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
