#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  JiraMigratorConfigError,
  loadJiraMigratorConfig,
  publicJiraMigratorConfig,
} from "./config.js";

const USAGE = `reef-jira-migrator

Usage:
  reef-jira-migrator --project-key SHDEV --vault <vault> [--jira-base-url <url>] [--dry-run]

Options:
  --dry-run                 Load config and report readiness without migrating.
  --jira-base-url <url>     Jira tenant URL. Can also use REEF_JIRA_BASE_URL.
  --jira-cloud-id <id>      Atlassian cloud id. Can derive the API gateway URL.
  --project-key <key>       Jira project key, for example SHDEV.
  --vault <vault>           Target Reef workspace vault.
  --report <path>           Optional local dry-run/report path.
  --api-token-file <path>   Local Jira API-token secret file.
  --bearer-token-file <path> Local Jira bearer-token secret file.
`;

const isHelp = (argv: readonly string[]) =>
  argv.includes("--help") || argv.includes("-h");

const formatError = (error: unknown): string => {
  if (error instanceof JiraMigratorConfigError) {
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

  try {
    const config = loadJiraMigratorConfig({ argv, env });
    process.stdout.write(
      `${JSON.stringify(publicJiraMigratorConfig(config))}\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(formatError(error));
    return 1;
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (entrypoint === import.meta.url) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
