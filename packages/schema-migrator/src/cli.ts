#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  SchemaLifecycleError,
  type StartupMigrationOperatorReport,
  createAkbAdapter,
  runStartupWorkspaceMigrations,
} from "@reef/core";

const PUBLIC_ERROR_CODE = "schema_migration_failed";

export interface PublicMigrationReport {
  status: "completed";
  workspace_count: number;
  skipped_vault_count: number;
  workspaces: Array<{
    vault: string;
    applied_phases: number;
    replayed_phases: number;
    checksums: string[];
  }>;
}

export interface PublicMigrationError {
  code: string;
  vault?: string;
  phase_id?: string;
}

export function projectPublicMigrationReport(
  report: StartupMigrationOperatorReport,
): PublicMigrationReport {
  return {
    status: report.status,
    workspace_count: report.workspaceCount,
    skipped_vault_count: report.skippedVaultCount,
    workspaces: report.workspaces.map((workspace) => ({
      vault: workspace.vault,
      applied_phases: workspace.appliedPhases,
      replayed_phases: workspace.replayedPhases,
      checksums: [...workspace.checksums],
    })),
  };
}

export function projectPublicMigrationError(
  error: unknown,
): PublicMigrationError {
  if (error instanceof SchemaLifecycleError) {
    return {
      code: error.context.reason,
      ...(error.context.vault ? { vault: error.context.vault } : {}),
      ...(error.context.phaseId ? { phase_id: error.context.phaseId } : {}),
    };
  }
  return { code: PUBLIC_ERROR_CODE };
}

export async function runCli(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PublicMigrationReport> {
  const baseUrl = env.AKB_BACKEND_URL?.trim() ?? "";
  const apiKey = env.REEF_SCHEMA_MIGRATION_KEY ?? "";
  const serviceUsername = env.REEF_SCHEMA_SERVICE_USERNAME?.trim() ?? "";
  if (!baseUrl || !apiKey.trim() || !serviceUsername) {
    throw new SchemaLifecycleError({ reason: "migration_config_invalid" });
  }
  const adapter = createAkbAdapter({ baseUrl, jwt: apiKey });
  const report = await runStartupWorkspaceMigrations({
    adapter,
    apiKey,
    serviceUsername,
  });
  return projectPublicMigrationReport(report);
}

async function main(): Promise<void> {
  try {
    process.stdout.write(`${JSON.stringify(await runCli())}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(projectPublicMigrationError(error))}\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
