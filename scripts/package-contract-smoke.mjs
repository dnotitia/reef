import { spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { discoverWorkspacePackages } from "./maintenance/workspaces.mjs";

const root = process.cwd();
const artifactPackageNames = [
  "@reef/core",
  "@reef/orchestrator",
  "@reef/harness-provider-codex",
  "@reef/infrastructure-provider-local",
  "@reef/work-provider-reef",
  "@reef/jira-migrator",
];
const artifactPackageSet = new Set(artifactPackageNames);
const publicImportSpecifiers = [
  ...artifactPackageNames,
  "@reef/core/status",
  "@reef/core/errors",
  "@reef/core/fields",
  "@reef/core/fields/planning",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
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
  return result.stdout;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function packageKey(name) {
  return name.replace(/^@[^/]+\//, "");
}

function rewriteWorkspaceDependencies(manifest, version) {
  for (const dependencies of [
    manifest.dependencies,
    manifest.optionalDependencies,
  ]) {
    if (!dependencies) continue;
    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        dependencies[name] = version;
      }
    }
  }
}

function collectPackageTargets(value, targets = []) {
  if (typeof value === "string") {
    targets.push(value);
  } else if (value && typeof value === "object") {
    for (const nested of Object.values(value))
      collectPackageTargets(nested, targets);
  }
  return targets;
}

function packageTargetPaths(manifest) {
  return [
    manifest.main,
    manifest.types,
    ...collectPackageTargets(manifest.exports),
    ...collectPackageTargets(manifest.bin),
  ].filter((target) => typeof target === "string");
}

async function assertArtifactPackage(packageDir, manifest) {
  const distDir = path.join(packageDir, "dist");
  const distStats = await stat(distDir).catch(() => null);
  if (!distStats?.isDirectory()) {
    throw new Error(`${manifest.name} has no buildable dist directory`);
  }
  const artifactFiles = await listFiles(distDir);
  if (
    artifactFiles.some((file) =>
      /(?:\.test|\.spec|testSupport|TestSupport|Fixtures|fixtures)\.(?:js|d\.ts|map)$/.test(
        file,
      ),
    )
  ) {
    throw new Error(`${manifest.name} emitted test or fixture files`);
  }

  for (const target of packageTargetPaths(manifest)) {
    if (!target.startsWith("./") || target.includes("src")) {
      throw new Error(
        `${manifest.name} exposes a non-dist package target: ${target}`,
      );
    }
    const targetPath = path.join(packageDir, target);
    const targetStats = await stat(targetPath).catch(() => null);
    if (!targetStats?.isFile()) {
      throw new Error(
        `${manifest.name} exposes a missing package target: ${target}`,
      );
    }
  }

  if (JSON.stringify(manifest.files) !== JSON.stringify(["dist"])) {
    throw new Error(`${manifest.name} must package only dist`);
  }
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(
        ...(await listFiles(path.join(directory, entry.name), relativePath)),
      );
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

async function assertInstalledArtifact(packageDir, packageName) {
  const linkStats = await lstat(packageDir).catch(() => null);
  let installedDir = packageDir;
  if (linkStats?.isSymbolicLink()) {
    installedDir = await realpath(packageDir);
    const virtualStore = `${path.sep}.pnpm${path.sep}`;
    if (
      !installedDir.includes(virtualStore) ||
      installedDir.startsWith(path.join(root, "packages"))
    ) {
      throw new Error(
        `${packageName} was installed through a workspace or source symlink`,
      );
    }
  }
  if (!linkStats?.isDirectory() && !linkStats?.isSymbolicLink()) {
    throw new Error(`${packageName} was not installed as a package directory`);
  }
  const files = await listFiles(installedDir);
  const invalidFiles = files.filter(
    (file) =>
      file !== "package.json" &&
      !file.startsWith("dist/") &&
      file !== "dist" &&
      !file.startsWith("node_modules/.bin/"),
  );
  if (
    invalidFiles.length > 0 ||
    files.some((file) =>
      file.split(path.sep).some((part) => part === "src" || part === "tsx"),
    )
  ) {
    throw new Error(`${packageName} installed files are not source-isolated`);
  }
  if (
    files.some(
      (file) =>
        /\.(?:ts|tsx|mts|cts|jsx)$/.test(file) && !file.endsWith(".d.ts"),
    )
  ) {
    throw new Error(`${packageName} installed a TypeScript source file`);
  }
}

async function packArtifactPackages(packRoot, packages, version) {
  const tarballs = new Map();
  const stageRoot = path.join(packRoot, "stage");
  const tarballRoot = path.join(packRoot, "tarballs");

  for (const packageInfo of packages) {
    const stageDir = path.join(stageRoot, packageKey(packageInfo.name));
    await cp(path.join(packageInfo.dir, "dist"), path.join(stageDir, "dist"), {
      recursive: true,
    });
    const manifest = structuredClone(packageInfo.manifest);
    manifest.private = false;
    manifest.version = version;
    manifest.files = ["dist"];
    manifest.devDependencies = undefined;
    rewriteWorkspaceDependencies(manifest, version);
    await writeFile(
      path.join(stageDir, "package.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    const before = new Set(await readdir(tarballRoot));
    run(
      "pnpm",
      ["pack", "--pack-destination", tarballRoot, "--reporter", "silent"],
      {
        cwd: stageDir,
      },
    );
    const created = (await readdir(tarballRoot)).filter(
      (file) => !before.has(file),
    );
    if (created.length !== 1 || !created[0].endsWith(".tgz")) {
      throw new Error(
        `${packageInfo.name} did not produce exactly one package tarball`,
      );
    }
    tarballs.set(packageInfo.name, path.join(tarballRoot, created[0]));
  }

  return tarballs;
}

async function runSmoke() {
  const workspacePackages = await discoverWorkspacePackages({ root });
  const byName = new Map(
    workspacePackages.map((packageInfo) => [packageInfo.name, packageInfo]),
  );
  const packages = artifactPackageNames.map((name) => {
    const packageInfo = byName.get(name);
    if (!packageInfo)
      throw new Error(`Expected workspace package is missing: ${name}`);
    return packageInfo;
  });
  const workspaceArtifactNames = workspacePackages
    .map((packageInfo) => packageInfo.name)
    .filter((name) => artifactPackageSet.has(name));
  if (workspaceArtifactNames.length !== artifactPackageNames.length) {
    throw new Error(
      "Workspace discovery returned an unexpected package contract set",
    );
  }

  for (const packageInfo of packages) {
    await assertArtifactPackage(
      path.join(root, packageInfo.relativeDir),
      packageInfo.manifest,
    );
  }

  const packRoot = await mkdtemp(
    path.join(os.tmpdir(), "reef-package-contract-"),
  );
  try {
    await mkdir(path.join(packRoot, "stage"));
    await mkdir(path.join(packRoot, "tarballs"));
    const version = (await readJson(path.join(root, "package.json"))).version;
    const tarballs = await packArtifactPackages(packRoot, packages, version);
    const consumerDir = path.join(packRoot, "consumer");
    await mkdir(consumerDir);

    const dependencies = Object.fromEntries(
      artifactPackageNames.map((name) => [
        name,
        `file:${path.relative(consumerDir, tarballs.get(name))}`,
      ]),
    );
    await writeFile(
      path.join(consumerDir, "package.json"),
      `${JSON.stringify(
        {
          name: "reef-artifact-consumer",
          private: true,
          type: "module",
          dependencies,
        },
        null,
        2,
      )}\n`,
    );
    const overrides = artifactPackageNames
      .map((name) => `  "${name}": "file:${tarballs.get(name)}"`)
      .join("\n");
    await writeFile(
      path.join(consumerDir, "pnpm-workspace.yaml"),
      `overrides:\n${overrides}\n`,
    );

    run(
      "pnpm",
      [
        "install",
        "--ignore-scripts",
        "--no-frozen-lockfile",
        "--reporter",
        "silent",
      ],
      {
        cwd: consumerDir,
      },
    );

    for (const name of artifactPackageNames) {
      const packageDir = path.join(consumerDir, "node_modules", name);
      await assertInstalledArtifact(packageDir, name);
    }

    const importChecks = publicImportSpecifiers
      .map(
        (specifier, index) =>
          `const module${index} = await import(${JSON.stringify(specifier)});\n` +
          `if (Object.keys(module${index}).length === 0) throw new Error(${JSON.stringify(`${specifier} exported no public bindings`)});`,
      )
      .join("\n");
    run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `${importChecks}\nconsole.log("artifact imports passed");`,
      ],
      { cwd: consumerDir },
    );

    const helpOutput = run(
      "pnpm",
      ["exec", "--", "reef-jira-migrator", "--help"],
      {
        cwd: consumerDir,
      },
    );
    if (!/reef-jira-migrator|Usage:/i.test(helpOutput)) {
      throw new Error(
        "Installed reef-jira-migrator --help did not print CLI usage",
      );
    }
  } finally {
    await rm(packRoot, { recursive: true, force: true });
  }
}

try {
  await runSmoke();
  console.log(
    `package contract smoke passed: ${artifactPackageNames.length} isolated Node ESM packages, core public subpaths, and reef-jira-migrator --help`,
  );
} catch (error) {
  console.error(`package contract smoke failed: ${error.message}`);
  process.exitCode = 1;
}
