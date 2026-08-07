#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { discoverWorkspacePackages } from "./maintenance/workspaces.mjs";

const root = process.cwd();
const workspacePackages = await discoverWorkspacePackages({ root });
const packageByName = new Map(
  workspacePackages.map((packageInfo) => [packageInfo.name, packageInfo]),
);
const workspaceNames = new Set(packageByName.keys());
const rootManifest = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const turboConfig = JSON.parse(
  await readFile(path.join(root, "turbo.json"), "utf8"),
);
const ciWorkflow = await readFile(
  path.join(root, ".github", "workflows", "ci.yml"),
  "utf8",
);
const dockerfile = await readFile(path.join(root, "Dockerfile"), "utf8");

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertSetEqual(actual, expected, label) {
  const actualValues = sorted(actual);
  const expectedValues = sorted(expected);
  assert(
    JSON.stringify(actualValues) === JSON.stringify(expectedValues),
    `${label} mismatch: expected ${expectedValues.join(", ") || "<empty>"}; got ${actualValues.join(", ") || "<empty>"}`,
  );
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

function collectDependents(target) {
  const selected = new Set([target]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, dependencies] of dependencyGraph) {
      if (
        !selected.has(name) &&
        [...dependencies].some((dep) => selected.has(dep))
      ) {
        selected.add(name);
        changed = true;
      }
    }
  }
  return selected;
}

function collectDependencies(selected) {
  const closure = new Set(selected);
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of [...closure]) {
      for (const dependency of dependencyGraph.get(name) ?? []) {
        if (!closure.has(dependency)) {
          closure.add(dependency);
          changed = true;
        }
      }
    }
  }
  return closure;
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      TURBO_TELEMETRY_DISABLED: "1",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

function runTurboDry(tasks, options = {}, env = {}) {
  const args = ["exec", "turbo", "run", ...tasks];
  for (const [name, value] of Object.entries(options)) {
    args.push(value === true ? `--${name}` : `--${name}=${value}`);
  }
  const output = run("pnpm", [...args, "--dry=json"], env).stdout;
  const jsonStart = output.indexOf("{");
  assert(jsonStart >= 0, "Turbo dry-run did not return JSON");
  return JSON.parse(output.slice(jsonStart));
}

function runTurboJson(tasks, options, env = {}) {
  const args = ["exec", "turbo", "run", ...tasks];
  for (const [name, value] of Object.entries(options)) {
    args.push(value === true ? `--${name}` : `--${name}=${value}`);
  }
  const output = run("pnpm", [...args, "--json"], env).stdout;
  return output
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function taskById(dryRun, taskId) {
  const task = dryRun.tasks.find((candidate) => candidate.taskId === taskId);
  assert(task, `Turbo dry-run did not include ${taskId}`);
  return task;
}

function topologicalTaskOrder(tasks) {
  const taskByTaskId = new Map(tasks.map((task) => [task.taskId, task]));
  const visiting = new Set();
  const visited = new Set();
  const order = [];

  function visit(taskId) {
    if (visited.has(taskId)) return;
    assert(
      !visiting.has(taskId),
      `Turbo task graph contains a cycle at ${taskId}`,
    );
    const task = taskByTaskId.get(taskId);
    assert(task, `Turbo task graph references missing task ${taskId}`);
    visiting.add(taskId);
    for (const dependency of task.dependencies) {
      if (taskByTaskId.has(dependency)) visit(dependency);
    }
    visiting.delete(taskId);
    visited.add(taskId);
    order.push(taskId);
  }

  for (const task of tasks) visit(task.taskId);
  return order;
}

async function digestDirectory(directory) {
  const hash = createHash("sha256");
  async function visit(current, relative = "") {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryRelative = path.join(relative, entry.name);
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath, entryRelative);
      } else {
        hash.update(`${entryRelative}\0`);
        hash.update(await readFile(entryPath));
      }
    }
  }
  await visit(directory);
  return hash.digest("hex");
}

function cacheEvent(events, taskId, kind) {
  return events.find(
    (event) =>
      event.source === taskId &&
      typeof event.text === "string" &&
      new RegExp(`cache ${kind}`, "u").test(event.text),
  );
}

async function runCacheProof(packageName) {
  const cacheRoot = await mkdtemp(
    path.join(os.tmpdir(), "reef-turbo-contract-"),
  );
  const packageInfo = packageByName.get(packageName);
  assert(
    packageInfo,
    `cache probe package is not a workspace package: ${packageName}`,
  );
  const outputDirectory = path.join(packageInfo.dir, "dist");
  try {
    const options = {
      cache: "local:rw,remote:",
      "cache-dir": path.join(cacheRoot, "cache"),
      filter: packageName,
      "output-logs": "hash-only",
    };
    const coldEvents = runTurboJson(["build"], options, {
      NODE_ENV: "production",
      NEXT_PUBLIC_TURBO_CONTRACT_PROBE: "cold",
    });
    const coldDigest = await digestDirectory(outputDirectory);
    const cachedEvents = runTurboJson(["build"], options, {
      NODE_ENV: "production",
      NEXT_PUBLIC_TURBO_CONTRACT_PROBE: "cold",
    });
    const cachedDigest = await digestDirectory(outputDirectory);
    const invalidatedEvents = runTurboJson(["build"], options, {
      NODE_ENV: "production",
      NEXT_PUBLIC_TURBO_CONTRACT_PROBE: "changed",
    });

    const taskId = `${packageName}#build`;
    assert(
      cacheEvent(coldEvents, taskId, "miss"),
      `${taskId} did not cold-miss`,
    );
    assert(
      cacheEvent(cachedEvents, taskId, "hit"),
      `${taskId} did not cache-hit`,
    );
    assert(
      cacheEvent(invalidatedEvents, taskId, "miss"),
      `${taskId} did not invalidate after a declared environment input changed`,
    );
    assert(
      coldDigest === cachedDigest,
      `${taskId} cache changed its artifact digest`,
    );
    return {
      package: packageName,
      cold: { cache: "miss", digest: coldDigest },
      cached: { cache: "hit", digest: cachedDigest },
      invalidated: { cache: "miss", input: "NEXT_PUBLIC_TURBO_CONTRACT_PROBE" },
    };
  } finally {
    await rm(cacheRoot, { recursive: true, force: true });
  }
}

function verifyRepositoryHandoffs() {
  assert(
    /production-build:/u.test(ciWorkflow) && /pnpm run build/u.test(ciWorkflow),
    "CI must have one canonical production-build job",
  );
  assert(
    /actions\/upload-artifact@/u.test(ciWorkflow) &&
      /actions\/download-artifact@/u.test(ciWorkflow),
    "CI must upload and download the candidate-bound production artifact",
  );
  assert(
    /needs:\s*\[lint, typecheck, production-build\]/u.test(ciWorkflow),
    "every E2E shard must depend on the production artifact job",
  );
  assert(
    /\n {2}e2e:\n[\s\S]*?needs:\s*\[e2e-shard, production-build\]/u.test(
      ciWorkflow,
    ),
    "the aggregate E2E check must fail when the production artifact fails",
  );
  assert(
    /REEF_E2E_SKIP_BUILD=1/u.test(ciWorkflow) &&
      /sha256sum -c/u.test(ciWorkflow),
    "E2E shards must skip rebuilding and verify the artifact digest",
  );
  assert(
    /turbo\s+prune\s+@reef\/web\s+--docker/u.test(dockerfile),
    "Docker must prune the @reef/web workspace with Turbo",
  );
  assert(
    /turbo\s+prune\s+@reef\/web\s+--docker[\s\\]+&&\s*cp\s+tsdown\.config\.mjs\s+out\/full\/tsdown\.config\.mjs[\s\\]+&&\s*test\s+-f\s+out\/full\/tsdown\.config\.mjs/u.test(
      dockerfile,
    ),
    "Docker pruned output must contain the root tsdown build configuration",
  );
  assert(
    /tsconfig\.base\.json\s+out\/full\/tsconfig\.base\.json[\s\\]+&&\s*test\s+-f\s+out\/full\/tsconfig\.base\.json/u.test(
      dockerfile,
    ),
    "Docker pruned output must contain the root TypeScript base configuration",
  );
  assert(
    /out\/json/u.test(dockerfile) &&
      /out\/full/u.test(dockerfile) &&
      /pnpm-lock\.yaml/u.test(dockerfile),
    "Docker must install from the pruned manifests and lockfile",
  );
  assert(/USER 1001/u.test(dockerfile), "Docker runner must remain non-root");
  assert(
    !/RUN\s+.*(?:npm|pnpm)\s+install\s+(-g|--global).*turbo/u.test(dockerfile),
    "Docker must not install a second global Turbo version",
  );
  const forbiddenRemoteCacheNames = ["TURBO_TOKEN", "TURBO_TEAM"];
  const configText = JSON.stringify(turboConfig);
  for (const name of forbiddenRemoteCacheNames) {
    assert(
      !configText.includes(name),
      `${name} must not be part of Reef's cache contract`,
    );
  }
}

function gitRefExists(ref) {
  return (
    spawnSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd: root,
      stdio: "ignore",
    }).status === 0
  );
}

function runAffectedProof(allPackageNames, downstreamTarget) {
  const base = process.env.TURBO_SCM_BASE ?? "origin/main";
  const head = process.env.TURBO_SCM_HEAD ?? "HEAD";
  try {
    const dryRun = runTurboDry(
      ["build"],
      { affected: true },
      {
        TURBO_SCM_BASE: base,
        TURBO_SCM_HEAD: head,
      },
    );
    const selected = new Set(
      dryRun.packages.filter(
        (name) => name !== "//" && workspaceNames.has(name),
      ),
    );
    return {
      mode: gitRefExists(base) ? "git-history" : "turbo-fallback",
      base,
      head,
      selected: sorted(selected),
      taskCount: dryRun.tasks.length,
    };
  } catch (error) {
    assert(
      !gitRefExists(base),
      `Turbo affected selection failed with available history: ${error.message}`,
    );
    const fallback = runTurboDry(["build"], {
      filter: "./packages/**",
    });
    const selected = new Set(
      fallback.packages.filter((name) => workspaceNames.has(name)),
    );
    assertSetEqual(
      selected,
      allPackageNames,
      "history-insufficient affected fallback",
    );
    return {
      mode: "history-fallback",
      base,
      head,
      selected: sorted(selected),
      taskCount: fallback.tasks.length,
    };
  }
}

async function main() {
  assert(
    workspacePackages.length > 0,
    "Turbo contract requires discovered workspaces",
  );
  assert(
    turboConfig.cacheDir === ".turbo/cache",
    "Turbo cacheDir must be worktree-relative",
  );
  assert(
    turboConfig.envMode === "strict",
    "Turbo must use strict environment mode",
  );
  assert(
    rootManifest.devDependencies?.turbo === "2.10.8",
    "root devDependency must pin the repository Turbo version",
  );
  assert(
    turboConfig.tasks?.build?.dependsOn?.includes("^build"),
    "build must depend on workspace dependency builds",
  );
  assert(
    turboConfig.tasks.build.inputs?.includes("$TURBO_DEFAULT$"),
    "build inputs must preserve $TURBO_DEFAULT$",
  );
  for (const output of ["dist/**", ".next/**", "!.next/cache/**"]) {
    assert(
      turboConfig.tasks.build.outputs.includes(output),
      `build output contract is missing ${output}`,
    );
  }
  for (const taskName of [
    "typecheck",
    "lint",
    "test",
    "test:eval",
    "test:behavior",
  ]) {
    assert(
      turboConfig.tasks[taskName]?.cache === false,
      `${taskName} must execute as a required verification instead of being restored from cache`,
    );
  }
  assert(
    turboConfig.globalPassThroughEnv.includes("REEF_*") &&
      turboConfig.globalPassThroughEnv.includes("OPENROUTER_*"),
    "deployment and compatibility secrets must be pass-through-only",
  );
  verifyRepositoryHandoffs();

  const allPackageNames = workspacePackages.map(
    (packageInfo) => packageInfo.name,
  );
  const buildDryRun = runTurboDry(["build"], { filter: "./packages/**" });
  const discoveredBuildPackages = new Set(
    buildDryRun.packages.filter((name) => workspaceNames.has(name)),
  );
  assertSetEqual(
    discoveredBuildPackages,
    allPackageNames,
    "Turbo workspace membership",
  );
  const buildTasks = buildDryRun.tasks.filter((task) => task.task === "build");
  assertSetEqual(
    new Set(buildTasks.map((task) => task.package)),
    new Set(allPackageNames),
    "Turbo build task membership",
  );
  const buildOrder = topologicalTaskOrder(buildTasks);
  const taskPositions = new Map(
    buildOrder.map((taskId, index) => [taskId, index]),
  );
  for (const task of buildTasks) {
    for (const dependency of task.dependencies) {
      if (taskPositions.has(dependency)) {
        assert(
          taskPositions.get(dependency) < taskPositions.get(task.taskId),
          `${dependency} must execute before ${task.taskId}`,
        );
      }
    }
    for (const dependency of dependencyGraph.get(task.package) ?? []) {
      assert(
        task.dependencies.includes(`${dependency}#build`),
        `${task.taskId} is missing its manifest workspace build dependency ${dependency}#build`,
      );
    }
  }

  const webTask = taskById(buildDryRun, "@reef/web#build");
  assert(
    webTask.excludedOutputs?.includes(".next/cache/**"),
    "web build must exclude Next framework cache",
  );
  assert(
    webTask.resolvedTaskDefinition.env.includes("NEXT_PUBLIC_*") &&
      turboConfig.tasks.build.env.includes("NEXT_PUBLIC_*"),
    "build environment inputs must include public Next configuration",
  );

  const downstreamCandidates = workspacePackages
    .map((packageInfo) => ({
      name: packageInfo.name,
      dependents: collectDependents(packageInfo.name).size - 1,
    }))
    .sort((left, right) => right.dependents - left.dependents);
  const downstreamTarget = downstreamCandidates[0]?.name;
  assert(
    downstreamTarget,
    "No workspace package is available for downstream proof",
  );
  const downstreamDryRun = runTurboDry(["build"], {
    filter: `...${downstreamTarget}`,
  });
  const downstreamPackages = new Set(
    downstreamDryRun.tasks
      .filter((task) => task.task === "build")
      .map((task) => task.package),
  );
  assertSetEqual(
    downstreamPackages,
    collectDependencies(collectDependents(downstreamTarget)),
    `downstream selection for ${downstreamTarget}`,
  );

  const selectedCachePackage = workspacePackages.find(
    (packageInfo) => (dependencyGraph.get(packageInfo.name)?.size ?? 0) === 0,
  )?.name;
  assert(
    selectedCachePackage,
    "No dependency-root package is available for cache proof",
  );
  const cache = await runCacheProof(selectedCachePackage);
  const affected = runAffectedProof(new Set(allPackageNames), downstreamTarget);

  console.log(
    JSON.stringify(
      {
        status: "passed",
        turboVersion: rootManifest.devDependencies.turbo,
        cacheDir: turboConfig.cacheDir,
        workspacePackages: sorted(allPackageNames),
        graph: {
          buildTasks: buildTasks.map((task) => ({
            taskId: task.taskId,
            dependencies: task.dependencies,
          })),
          buildOrder,
          downstreamTarget,
          downstreamSelection: sorted(downstreamPackages),
        },
        contract: {
          outputs: turboConfig.tasks.build.outputs,
          excludedOutputs: webTask.excludedOutputs,
          environment: {
            mode: turboConfig.envMode,
            hashed: turboConfig.tasks.build.env,
            passThrough: turboConfig.globalPassThroughEnv,
          },
        },
        cache,
        affected,
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} catch (error) {
  console.error(`turbo contract failed: ${error.message}`);
  process.exitCode = 1;
}
