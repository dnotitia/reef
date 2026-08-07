import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { discoverWorkspacePackages } from "./maintenance/workspaces.mjs";

const root = process.cwd();
const workspacePackages = await discoverWorkspacePackages({ root });
if (workspacePackages.length === 0) {
  throw new Error("Workspace discovery returned no packages");
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
