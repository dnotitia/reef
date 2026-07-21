#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { loadMigrationConfig } from "./config.js";
import {
  MigrationRunError,
  createCoreMigrationRuntime,
  runSchemaMigrations,
} from "./runner.js";

const HELP = `reef-schema-migrator

Usage:
  reef-schema-migrator

The runner always inventories every Reef workspace visible to the configured
migration service identity. Per-vault arguments are intentionally unsupported.
`;

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  if (argv.length > 0) {
    process.stderr.write('{"ok":false,"code":"arguments_invalid"}\n');
    return 2;
  }
  try {
    const config = loadMigrationConfig(env);
    const report = await runSchemaMigrations({
      runtime: createCoreMigrationRuntime(config),
      serviceAccount: config.serviceAccount,
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return 0;
  } catch (error) {
    const report =
      error instanceof MigrationRunError
        ? error.report
        : { ok: false, code: "migration_config_invalid" };
    process.stderr.write(`${JSON.stringify(report)}\n`);
    return 1;
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entrypoint === import.meta.url) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
