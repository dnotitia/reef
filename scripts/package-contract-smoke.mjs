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

import { parseDocument } from "yaml";

import { discoverWorkspacePackages } from "./maintenance/workspaces.mjs";

const root = process.cwd();

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

function readDefaultCatalog(workspaceYaml) {
  const document = parseDocument(workspaceYaml, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(
      `pnpm-workspace.yaml could not be parsed: ${document.errors[0].message}`,
    );
  }
  const value = document.toJS();
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !value.catalog ||
    typeof value.catalog !== "object" ||
    Array.isArray(value.catalog)
  ) {
    throw new Error(
      "pnpm-workspace.yaml must define a default catalog mapping",
    );
  }
  return value.catalog;
}

function packageKey(name) {
  return name.replace(/^@[^/]+\//, "");
}

function isArtifactPackage(packageInfo) {
  return (
    Array.isArray(packageInfo.manifest.files) &&
    packageInfo.manifest.files.length === 1 &&
    packageInfo.manifest.files[0] === "dist"
  );
}

function publicImportSpecifiers(packages) {
  return packages.flatMap(({ name, manifest }) => [
    name,
    ...Object.keys(manifest.exports ?? {})
      .filter((specifier) => specifier !== ".")
      .map((specifier) => `${name}${specifier.slice(1)}`),
  ]);
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

function rewriteCatalogDependencies(manifest, catalog) {
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const dependencies = manifest[field];
    if (!dependencies) continue;
    for (const [name, range] of Object.entries(dependencies)) {
      if (range === "catalog:") {
        const version = catalog[name];
        if (typeof version !== "string") {
          throw new Error(`default catalog entry is missing for ${name}`);
        }
        dependencies[name] = version;
      } else if (typeof range === "string" && range.startsWith("catalog:")) {
        throw new Error(`${name} uses an unsupported named catalog reference`);
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

async function packArtifactPackages(packRoot, packages, version, catalog) {
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
    rewriteCatalogDependencies(manifest, catalog);
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
  const packages = workspacePackages.filter(isArtifactPackage);
  if (packages.length === 0) {
    throw new Error("Workspace discovery returned no artifact packages");
  }
  const artifactPackageNames = packages.map((packageInfo) => packageInfo.name);
  const importSpecifiers = publicImportSpecifiers(packages);
  const cliPackage = packages.find((packageInfo) => {
    const bin = packageInfo.manifest.bin;
    return (
      typeof bin === "string" ||
      (bin && typeof bin === "object" && Object.keys(bin).length > 0)
    );
  });

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
    const catalog = readDefaultCatalog(
      await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8"),
    );
    const tarballs = await packArtifactPackages(
      packRoot,
      packages,
      version,
      catalog,
    );
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

    const importChecks = importSpecifiers
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

    if (cliPackage) {
      const bin = cliPackage.manifest.bin;
      const binName =
        typeof bin === "string" ? cliPackage.name : Object.keys(bin)[0];
      const helpOutput = run("pnpm", ["exec", "--", binName, "--help"], {
        cwd: consumerDir,
      });
      if (!new RegExp(`${binName}|Usage:`, "i").test(helpOutput)) {
        throw new Error(`Installed ${binName} --help did not print CLI usage`);
      }
    }
  } finally {
    await rm(packRoot, { recursive: true, force: true });
  }
}

try {
  await runSmoke();
  console.log(
    "package contract smoke passed: dynamically discovered isolated Node ESM packages, public exports, and CLI help",
  );
} catch (error) {
  console.error(`package contract smoke failed: ${error.message}`);
  process.exitCode = 1;
}
