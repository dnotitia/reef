import { rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { discoverWorkspacePackages } from "./maintenance/workspaces.mjs";

const artifactPackageNames = [
  "@reef/core",
  "@reef/orchestrator",
  "@reef/harness-provider-codex",
  "@reef/infrastructure-provider-local",
  "@reef/work-provider-reef",
  "@reef/jira-migrator",
];
const packages = await discoverWorkspacePackages({ root: process.cwd() });
const byName = new Map(
  packages.map((packageInfo) => [packageInfo.name, packageInfo]),
);

for (const name of artifactPackageNames) {
  const packageInfo = byName.get(name);
  if (!packageInfo)
    throw new Error(`Expected workspace package is missing: ${name}`);
  await rm(path.join(packageInfo.dir, "dist"), {
    recursive: true,
    force: true,
  });
}
