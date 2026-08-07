#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { discoverWorkspacePackages } from "./maintenance/workspaces.mjs";

const root = process.cwd();
const artifactPath = path.join(
  root,
  "ci-artifacts",
  "reef-web-production.tar.gz",
);
const workspacePackages = await discoverWorkspacePackages({ root });
const packageByName = new Map(
  workspacePackages.map((packageInfo) => [packageInfo.name, packageInfo]),
);
const workspaceNames = new Set(packageByName.keys());
const webPackage = packageByName.get("@reef/web");

if (!webPackage) {
  throw new Error("Production artifact requires the @reef/web workspace");
}

function workspaceDependencies(packageInfo) {
  const dependencies = new Set();
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const [name, specifier] of Object.entries(
      packageInfo.manifest[field] ?? {},
    )) {
      if (
        workspaceNames.has(name) &&
        typeof specifier === "string" &&
        specifier.startsWith("workspace:")
      ) {
        dependencies.add(name);
      }
    }
  }
  return dependencies;
}

const dependencyGraph = new Map(
  workspacePackages.map((packageInfo) => [
    packageInfo.name,
    workspaceDependencies(packageInfo),
  ]),
);
const buildClosure = new Set([webPackage.name]);
let changed = true;
while (changed) {
  changed = false;
  for (const packageName of [...buildClosure]) {
    for (const dependency of dependencyGraph.get(packageName) ?? []) {
      if (!buildClosure.has(dependency)) {
        buildClosure.add(dependency);
        changed = true;
      }
    }
  }
}

const archivePaths = [
  path.join(webPackage.relativeDir, ".next", "standalone"),
  path.join(webPackage.relativeDir, ".next", "static"),
  path.join(webPackage.relativeDir, "public"),
];
const workspaceBuildArtifacts = [];

for (const packageName of buildClosure) {
  if (packageName === webPackage.name) continue;
  const packageInfo = packageByName.get(packageName);
  const relativeDist = path.join(packageInfo.relativeDir, "dist");
  const absoluteDist = path.join(root, relativeDist);
  const distStats = await stat(absoluteDist).catch(() => null);
  if (!distStats?.isDirectory()) {
    throw new Error(
      `Workspace dependency ${packageName} has no build artifact at ${relativeDist}`,
    );
  }
  archivePaths.push(relativeDist);
  workspaceBuildArtifacts.push({ package: packageName, path: relativeDist });
}

await mkdir(path.dirname(artifactPath), { recursive: true });
const result = spawnSync(
  "tar",
  ["-C", root, "-czf", artifactPath, ...archivePaths],
  {
    cwd: root,
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(
    `Production artifact packaging failed with exit code ${result.status}`,
  );
}

console.log(
  JSON.stringify(
    {
      status: "packaged",
      artifact: path.relative(root, artifactPath),
      webPackage: webPackage.name,
      workspaceBuildArtifacts,
    },
    null,
    2,
  ),
);
