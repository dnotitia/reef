import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.dirname(fileURLToPath(import.meta.url));

function packageConfig(relativeDirectory, name, entry, overrides = {}) {
  return {
    cwd: path.join(repositoryRoot, relativeDirectory),
    name,
    entry,
    root: "src",
    outDir: "dist",
    clean: true,
    format: "esm",
    dts: true,
    deps: {
      neverBundle: [/^[^./]/],
    },
    fixedExtension: false,
    hash: false,
    report: false,
    failOnWarn: true,
    ...overrides,
  };
}

export default [
  packageConfig(
    "packages/core",
    "@reef/core",
    {
      index: "src/index.ts",
      "models/status": "src/models/status.ts",
      "errors/index": "src/errors/index.ts",
      "schemas/issues/fieldRegistry": "src/schemas/issues/fieldRegistry.ts",
      "schemas/planning/fieldRegistry": "src/schemas/planning/fieldRegistry.ts",
    },
    { unbundle: true },
  ),
  packageConfig("packages/orchestration/runtime", "@reef/orchestrator", {
    index: "src/index.ts",
  }),
  packageConfig(
    "packages/orchestration/controller",
    "@reef/orchestration-controller",
    { index: "src/index.ts" },
  ),
  packageConfig("packages/orchestration/cli", "@reef/orchestration-cli", {
    index: "src/index.ts",
    cli: "src/cli.ts",
  }),
  packageConfig(
    "packages/orchestration/providers/codex",
    "@reef/harness-provider-codex",
    { index: "src/index.ts" },
  ),
  packageConfig(
    "packages/orchestration/providers/local",
    "@reef/infrastructure-provider-local",
    { index: "src/index.ts" },
  ),
  packageConfig(
    "packages/orchestration/providers/local-validation",
    "@reef/validation-provider-local",
    { index: "src/index.ts" },
  ),
  packageConfig(
    "packages/orchestration/providers/github",
    "@reef/scm-provider-github",
    { index: "src/index.ts" },
  ),
  packageConfig(
    "packages/orchestration/providers/reef",
    "@reef/work-provider-reef",
    { index: "src/index.ts" },
  ),
  packageConfig("packages/jira-migrator", "@reef/jira-migrator", {
    index: "src/index.ts",
    cli: "src/cli.ts",
  }),
  packageConfig("packages/event-processor", "@reef/event-processor", {
    index: "src/index.ts",
  }),
];
