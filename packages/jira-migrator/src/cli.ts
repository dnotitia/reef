#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  JiraMigratorConfigError,
  loadJiraMigratorConfig,
  redactForConfig,
} from "./cli/config.js";
import {
  type JiraRunnerDependencies,
  JiraRunnerError,
  type JiraRunnerResult,
  runJiraMigration,
} from "./runner/runner.js";

const USAGE = `reef-jira-migrator

Usage:
  reef-jira-migrator (--dry-run | --apply) --project-key PROJECT [--project-key PROJECT ...]
    --jira-cloud-id ID --vault VAULT --mapping-policy PROJECT=PATH
    --ledger-path PATH --archive-root PATH --account-mapping-path PATH --report-path PATH
    [--board-id ID ...] [--run-id ID] [--resume ID]
    [--expected-plan-sha256 SHA256]

Safety:
  Exactly one mode is required. Apply requires --expected-plan-sha256 from a
  successful dry-run report. Jira and AKB secrets are accepted only through
  environment variables or private secret files; secret values are never argv.

Source:
  --jira-base-url URL       Jira tenant URL (or REEF_JIRA_BASE_URL).
  --jira-cloud-id ID        Stable Jira cloud scope.
  --project-key KEY         Repeatable Jira project scope.
  --board-id ID             Repeatable explicit Jira board scope.
  --mapping-policy P=PATH   Repeat once per project.
  --api-token-file PATH     Private Jira API-token file.
  --bearer-token-file PATH  Private Jira bearer-token file.

Target:
  --akb-base-url URL        AKB URL (or AKB_BACKEND_URL).
  --vault VAULT             Target Reef vault.
  --akb-jwt-file PATH       Private AKB JWT file (or REEF_AKB_JWT).

Artifacts:
  --run-id ID
  --ledger-path PATH
  --archive-root PATH
  --account-mapping-path PATH
  --report-path PATH

Control:
  --resume RUN_ID
  --expected-plan-sha256 SHA256
  --attest-comment-catalog-complete
  --retry-count N
  --retry-base-delay-ms N
  --retry-max-delay-ms N
`;

const isHelp = (argv: readonly string[]) =>
  argv.includes("--help") || argv.includes("-h");

const safeError = (error: unknown): Record<string, unknown> => {
  if (error instanceof JiraMigratorConfigError) {
    return { code: error.message, issues: error.issues };
  }
  if (error instanceof JiraRunnerError) {
    return { code: error.code };
  }
  if (error instanceof Error) {
    const code =
      "code" in error && typeof error.code === "string"
        ? error.code
        : error.name;
    return { code };
  }
  return { code: "unknown_error" };
};

export interface JiraCliDependencies {
  run?: (
    config: ReturnType<typeof loadJiraMigratorConfig>,
    dependencies?: JiraRunnerDependencies,
  ) => Promise<JiraRunnerResult>;
  runnerDependencies?: JiraRunnerDependencies;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  dependencies: JiraCliDependencies = {},
): Promise<number> {
  if (isHelp(argv)) {
    process.stdout.write(USAGE);
    return 0;
  }

  let config: ReturnType<typeof loadJiraMigratorConfig> | null = null;
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    config = loadJiraMigratorConfig({ argv, env });
    const run = dependencies.run ?? runJiraMigration;
    const result = await run(config, {
      ...dependencies.runnerDependencies,
      signal: controller.signal,
    });
    process.stdout.write(
      `${JSON.stringify({
        run_id: result.runId,
        mode: result.mode,
        plan_sha256: result.planSha256,
        report_path: config.artifacts.reportPath,
        status: result.report.run.status,
      })}\n`,
    );
    return result.report.run.status === "completed" ? 0 : 1;
  } catch (error) {
    const safe = config
      ? redactForConfig(config, safeError(error))
      : safeError(error);
    process.stderr.write(`${JSON.stringify(safe)}\n`);
    if (error instanceof JiraRunnerError && error.code === "interrupted") {
      return 130;
    }
    return error instanceof JiraMigratorConfigError ? 2 : 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (entrypoint === import.meta.url) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
