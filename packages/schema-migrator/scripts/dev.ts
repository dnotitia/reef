#!/usr/bin/env node

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  MIGRATION_ONLY_ENV_KEYS,
  type MigrationConfig,
  loadMigrationConfig,
} from "../src/config.js";
import {
  createCoreMigrationRuntime,
  runSchemaMigrations,
} from "../src/runner.js";

interface SpawnedProcess {
  once(event: "error", listener: () => void): this;
  once(
    event: "exit",
    listener: (code: number | null, signal: string | null) => void,
  ): this;
}

export type SpawnDevelopmentProcess = (
  command: string,
  args: readonly string[],
  options: { stdio: "inherit"; env: NodeJS.ProcessEnv },
) => SpawnedProcess;

export function developmentChildEnvironment(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const child = { ...env };
  for (const key of MIGRATION_ONLY_ENV_KEYS) delete child[key];
  return child;
}

export async function startDevelopment({
  env = process.env,
  runMigration = async (config: MigrationConfig) =>
    runSchemaMigrations({
      runtime: createCoreMigrationRuntime(config),
      serviceAccount: config.serviceAccount,
    }),
  spawnProcess = spawn as unknown as SpawnDevelopmentProcess,
}: {
  env?: NodeJS.ProcessEnv;
  runMigration?: (config: MigrationConfig) => Promise<unknown>;
  spawnProcess?: SpawnDevelopmentProcess;
} = {}): Promise<number> {
  let config: MigrationConfig;
  try {
    config = loadMigrationConfig(env);
    await runMigration(config);
  } catch {
    process.stderr.write('{"ok":false,"code":"migration_startup_failed"}\n');
    return 1;
  }

  return new Promise((resolve) => {
    const child = spawnProcess("pnpm", ["--filter", "@reef/web", "dev"], {
      stdio: "inherit",
      env: developmentChildEnvironment(env),
    });
    child.once("error", () => resolve(1));
    child.once("exit", (code, signal) => {
      resolve(signal === null ? (code ?? 1) : 1);
    });
  });
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entrypoint === import.meta.url) {
  startDevelopment().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
