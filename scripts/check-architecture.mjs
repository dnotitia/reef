import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { discoverWorkspacePackages } from "./maintenance/workspaces.mjs";

const root = process.cwd();
const requiredWorkspaceNames = new Set([
  "@reef/core",
  "@reef/web",
  "@reef/jira-migrator",
  "@reef/orchestrator",
  "@reef/harness-provider-codex",
  "@reef/work-provider-reef",
]);

const workspacePackages = await discoverWorkspacePackages({ root });
const workspaceNames = new Set(
  workspacePackages.map((packageInfo) => packageInfo.name),
);
for (const name of requiredWorkspaceNames) {
  if (!workspaceNames.has(name)) {
    throw new Error(`Required workspace package is missing: ${name}`);
  }
}

const sourceRoots = workspacePackages
  .filter((packageInfo) => packageInfo.srcRoot)
  .map((packageInfo) => path.join(root, packageInfo.srcRoot));
const result = spawnSync(
  "pnpm",
  [
    "exec",
    "depcruise",
    "--config",
    "dependency-cruiser.cjs",
    "--output-type",
    "err",
    "--progress",
    "none",
    ...sourceRoots,
  ],
  { cwd: root, stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  console.log(
    `architecture check passed: ${sourceRoots.length} workspace source roots`,
  );
}
