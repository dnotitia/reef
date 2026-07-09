#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { OrchestratorConfigError, loadOrchestratorConfig } from "./config.js";
import { runOrchestrator } from "./loop.js";
import { installShutdownHandlers } from "./shutdown.js";

const USAGE = `reef-orchestrator

Usage:
  reef-orchestrator --vault <vault> [--dry-run]

Options:
  --dry-run                 Load config and report readiness without claiming work.
  --vault <vault>           Reef workspace vault name. Can also use REEF_ORCHESTRATOR_VAULT.
  --poll-interval-ms <ms>   Idle loop poll interval. Default: 30000.
  --shutdown-grace-ms <ms>  Reserved shutdown grace window. Default: 10000.
`;

const isHelp = (argv: readonly string[]) =>
  argv.includes("--help") || argv.includes("-h");

const formatError = (error: unknown): string => {
  if (error instanceof OrchestratorConfigError) {
    return `${error.message}: ${error.issues.join("; ")}\n`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}\n`;
  return `${String(error)}\n`;
};

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (isHelp(argv)) {
    process.stdout.write(USAGE);
    return 0;
  }

  const shutdown = installShutdownHandlers();
  try {
    const config = loadOrchestratorConfig({ argv, env });
    await runOrchestrator(config, { signal: shutdown.signal });
    return 0;
  } catch (error) {
    process.stderr.write(formatError(error));
    return 1;
  } finally {
    shutdown.dispose();
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (entrypoint === import.meta.url) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
