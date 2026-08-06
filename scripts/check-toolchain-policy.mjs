#!/usr/bin/env node
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseDocument } from "yaml";

import { discoverWorkspacePackages } from "./maintenance/workspaces.mjs";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const CATALOG_PROTOCOL = "catalog:";
const WORKSPACE_PROTOCOL = "workspace:";
const NODE_MAJOR = 22;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function relativePath(root, filePath) {
  const relative = path.relative(root, filePath);
  return relative || ".";
}

async function readJson(filePath) {
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Cannot read ${filePath}: ${error.message}`);
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function parseDefaultCatalog(workspaceYaml) {
  const errors = [];
  let document;
  try {
    document = parseDocument(workspaceYaml, { uniqueKeys: true });
  } catch (error) {
    errors.push({
      code: "catalog-format",
      message: `pnpm-workspace.yaml could not be parsed: ${error.message}`,
    });
    return { catalog: null, errors, hasNamedCatalogs: false };
  }

  if (document.errors.length > 0) {
    for (const error of document.errors) {
      errors.push({
        code: "catalog-format",
        message: `pnpm-workspace.yaml could not be parsed: ${error.message}`,
      });
    }
    return { catalog: null, errors, hasNamedCatalogs: false };
  }

  const documentValue = document.toJS();
  if (!isRecord(documentValue)) {
    return {
      catalog: null,
      errors: [
        {
          code: "catalog-format",
          message: "pnpm-workspace.yaml must contain a mapping",
        },
      ],
      hasNamedCatalogs: false,
    };
  }

  const hasNamedCatalogs = Object.hasOwn(documentValue, "catalogs");
  if (!Object.hasOwn(documentValue, "catalog")) {
    return { catalog: null, errors, hasNamedCatalogs };
  }

  const catalogValue = documentValue.catalog;
  if (!isRecord(catalogValue)) {
    errors.push({
      code: "catalog-format",
      message: "pnpm-workspace.yaml catalog must be a mapping",
    });
    return { catalog: null, errors, hasNamedCatalogs };
  }

  const catalog = {};
  for (const [name, version] of Object.entries(catalogValue)) {
    if (typeof version !== "string" || version.trim() === "") {
      errors.push({
        code: "catalog-format",
        message: `pnpm-workspace.yaml catalog entry ${name} must have a non-empty string version`,
      });
      continue;
    }
    catalog[name] = version;
  }

  return {
    catalog,
    errors,
    hasNamedCatalogs,
  };
}

function addViolation(violations, code, message, paths = []) {
  const normalizedPaths = [...new Set(paths)].sort();
  const key = `${code}:${message}:${normalizedPaths.join(",")}`;
  if (violations.some((violation) => violation.key === key)) return;
  violations.push({ code, message, paths: normalizedPaths, key });
}

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(left, right) {
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch
  );
}

function parseEngineFloor(range) {
  const match = /(?:^|\s|>=|>|=|\^|~)(\d+)(?:\.(\d+))?(?:\.(\d+))?/u.exec(
    range,
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
  };
}

function parseCatalogVersionFloor(range) {
  const match = /^[\s<>=~^]*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/u.exec(
    range.trim(),
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
  };
}

async function listWorkflowFiles(workflowRoot) {
  try {
    const entries = await readdir(workflowRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.(?:yml|yaml)$/u.test(entry.name))
      .map((entry) => path.join(workflowRoot, entry.name));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function dependencyOccurrences(entries) {
  const occurrences = new Map();
  for (const entry of entries) {
    for (const field of DEPENDENCY_FIELDS) {
      const dependencies = entry.manifest[field];
      if (!isRecord(dependencies)) continue;
      for (const [name, spec] of Object.entries(dependencies)) {
        if (!occurrences.has(name)) occurrences.set(name, new Map());
        const byManifest = occurrences.get(name);
        if (!byManifest.has(entry.key)) {
          byManifest.set(entry.key, { ...entry, field, name, spec });
        }
      }
    }
  }
  return occurrences;
}

function dependencyEntries(entries) {
  return entries.flatMap((entry) =>
    DEPENDENCY_FIELDS.flatMap((field) => {
      const dependencies = entry.manifest[field];
      if (!isRecord(dependencies)) return [];
      return Object.entries(dependencies).map(([name, spec]) => ({
        ...entry,
        field,
        name,
        spec,
      }));
    }),
  );
}

function validateCatalogToolchain({ catalog, violations }) {
  const requirements = [
    {
      name: "typescript",
      major: 5,
      minor: 9,
      code: "typescript-version",
      label: "TypeScript 5.9",
    },
    {
      name: "@types/node",
      major: NODE_MAJOR,
      code: "node-types-version",
      label: `@types/node for Node ${NODE_MAJOR}`,
    },
  ];

  for (const requirement of requirements) {
    const version = catalog[requirement.name];
    if (typeof version !== "string") continue;
    const floor = parseCatalogVersionFloor(version);
    if (
      !floor ||
      floor.major !== requirement.major ||
      (requirement.minor !== undefined && floor.minor !== requirement.minor)
    ) {
      addViolation(
        violations,
        requirement.code,
        `default catalog ${requirement.name} must select ${requirement.label}`,
        ["pnpm-workspace.yaml"],
      );
    }
  }
}

function validateDependencies({
  root,
  rootManifest,
  workspacePackages,
  catalogInfo,
  violations,
}) {
  const entries = [
    {
      key: "root",
      dir: root,
      relativeDir: ".",
      name: rootManifest.name || "<root>",
      manifest: rootManifest,
    },
    ...workspacePackages.map((packageInfo) => ({
      key: packageInfo.relativeDir,
      dir: packageInfo.dir,
      relativeDir: packageInfo.relativeDir,
      name: packageInfo.name,
      manifest: packageInfo.manifest,
    })),
  ];
  const workspaceNames = new Set(workspacePackages.map(({ name }) => name));
  const occurrences = dependencyOccurrences(entries);
  const dependencies = dependencyEntries(entries);
  const catalog = catalogInfo.catalog ?? {};
  const catalogUsage = new Set();
  const rootTools = new Set([
    ...Object.keys(rootManifest.dependencies ?? {}),
    ...Object.keys(rootManifest.devDependencies ?? {}),
    ...Object.keys(rootManifest.optionalDependencies ?? {}),
    ...Object.keys(rootManifest.peerDependencies ?? {}),
  ]);

  validateCatalogToolchain({ catalog, violations });

  for (const field of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const name of Object.keys(rootManifest[field] ?? {})) {
      addViolation(
        violations,
        "root-runtime-dependency",
        `root manifest must not own production dependency ${name}`,
        ["package.json"],
      );
    }
  }

  for (const entry of dependencies) {
    const manifestPath = relativePath(
      root,
      path.join(entry.dir, "package.json"),
    );
    if (typeof entry.spec !== "string") {
      addViolation(
        violations,
        "dependency-spec",
        `${manifestPath} ${entry.field}.${entry.name} must use a string specifier`,
        [manifestPath],
      );
      continue;
    }

    if (workspaceNames.has(entry.name)) {
      if (
        !entry.spec.startsWith(WORKSPACE_PROTOCOL) ||
        entry.spec === WORKSPACE_PROTOCOL
      ) {
        addViolation(
          violations,
          "workspace-protocol",
          `${manifestPath} ${entry.name} must use a non-empty workspace: protocol`,
          [manifestPath],
        );
      }
      continue;
    }
    if (entry.spec.startsWith(WORKSPACE_PROTOCOL)) {
      addViolation(
        violations,
        "workspace-target",
        `${manifestPath} ${entry.name} uses workspace: but is not a discovered workspace package`,
        [manifestPath],
      );
      continue;
    }

    if (entry.spec.startsWith(CATALOG_PROTOCOL)) {
      if (entry.spec !== CATALOG_PROTOCOL) {
        addViolation(
          violations,
          "named-catalog-use",
          `${manifestPath} ${entry.name} must use the single default catalog: protocol`,
          [manifestPath],
        );
        continue;
      }
      if (!Object.hasOwn(catalog, entry.name)) {
        addViolation(
          violations,
          "catalog-key-missing",
          `${manifestPath} ${entry.name} uses catalog: without a default catalog entry`,
          [manifestPath, "pnpm-workspace.yaml"],
        );
        continue;
      }
      catalogUsage.add(entry.name);
      continue;
    }

    if (Object.hasOwn(catalog, entry.name)) {
      addViolation(
        violations,
        "catalog-bypass",
        `${manifestPath} ${entry.name} must use the default catalog: protocol`,
        [manifestPath, "pnpm-workspace.yaml"],
      );
    }
  }

  for (const [name, byManifest] of occurrences) {
    const packageOccurrences = [...byManifest.values()];
    const workspaceOccurrence = packageOccurrences.find(
      (entry) => entry.key !== "root" && workspaceNames.has(name),
    );
    if (workspaceOccurrence) continue;

    if (
      rootTools.has(name) &&
      packageOccurrences.some((entry) => entry.key !== "root")
    ) {
      addViolation(
        violations,
        "root-tool-duplicate",
        `${name} is a root-owned tool and must not be declared in a workspace manifest`,
        packageOccurrences.map((entry) =>
          relativePath(root, path.join(entry.dir, "package.json")),
        ),
      );
      continue;
    }
    if (Object.hasOwn(catalog, name)) continue;
    if (packageOccurrences.length < 2) continue;

    const nonCatalog = packageOccurrences.filter(
      (entry) => entry.spec !== CATALOG_PROTOCOL,
    );
    if (nonCatalog.length === 0) continue;
    addViolation(
      violations,
      "shared-dependency-not-catalog",
      `${name} is shared by multiple manifests and must use the default catalog: protocol everywhere`,
      packageOccurrences.map((entry) =>
        relativePath(root, path.join(entry.dir, "package.json")),
      ),
    );
  }

  for (const name of Object.keys(catalog)) {
    if (!catalogUsage.has(name)) {
      addViolation(
        violations,
        "catalog-unused",
        `default catalog entry ${name} is not consumed by a manifest`,
        ["pnpm-workspace.yaml"],
      );
    }
  }

  for (const error of catalogInfo.errors) {
    addViolation(violations, error.code, error.message, [
      "pnpm-workspace.yaml",
    ]);
  }
  if (catalogInfo.hasNamedCatalogs) {
    addViolation(
      violations,
      "named-catalog",
      "pnpm-workspace.yaml must contain only the default catalog mapping",
      ["pnpm-workspace.yaml"],
    );
  }
  if (catalogInfo.catalog === null) {
    addViolation(
      violations,
      "catalog-missing",
      "pnpm-workspace.yaml must define one default catalog mapping",
      ["pnpm-workspace.yaml"],
    );
  } else if (Object.keys(catalogInfo.catalog).length === 0) {
    addViolation(
      violations,
      "catalog-empty",
      "pnpm-workspace.yaml default catalog must not be empty",
      ["pnpm-workspace.yaml"],
    );
  }
}

async function validateRuntime({
  root,
  rootManifest,
  workspacePackages,
  violations,
}) {
  const nodeVersionPath = path.join(root, ".node-version");
  const nodeVersionText = await readOptional(nodeVersionPath);
  const nodeVersion = nodeVersionText
    ? parseVersion(nodeVersionText.trim())
    : null;
  if (!nodeVersionText) {
    addViolation(
      violations,
      "node-version",
      "repository must declare one explicit Node version in .node-version",
      [".node-version"],
    );
  } else if (!nodeVersion || nodeVersion.major !== NODE_MAJOR) {
    addViolation(
      violations,
      "node-version",
      `.node-version must select Node ${NODE_MAJOR} with a full semver value`,
      [".node-version"],
    );
  }

  const engineRange = rootManifest.engines?.node;
  const engineFloor =
    typeof engineRange === "string" ? parseEngineFloor(engineRange) : null;
  if (!engineFloor || engineFloor.major !== NODE_MAJOR) {
    addViolation(
      violations,
      "node-engine",
      `root engines.node must have a Node ${NODE_MAJOR} lower bound`,
      ["package.json"],
    );
  } else if (nodeVersion && compareVersions(nodeVersion, engineFloor) < 0) {
    addViolation(
      violations,
      "node-engine-drift",
      ".node-version must satisfy the lower bound declared by root engines.node",
      [".node-version", "package.json"],
    );
  }

  for (const alternative of [".nvmrc", ".tool-versions"]) {
    if (
      await access(path.join(root, alternative))
        .then(() => true)
        .catch(() => false)
    ) {
      addViolation(
        violations,
        "node-version-duplicate",
        `${alternative} duplicates the canonical .node-version declaration`,
        [alternative, ".node-version"],
      );
    }
  }

  const packageManager = rootManifest.packageManager;
  const packageManagerMatch =
    typeof packageManager === "string" &&
    /^pnpm@(\d+\.\d+\.\d+)$/u.exec(packageManager);
  if (!packageManagerMatch) {
    addViolation(
      violations,
      "pnpm-version",
      "root packageManager must be the only exact pnpm@x.y.z declaration",
      ["package.json"],
    );
  }
  for (const packageInfo of workspacePackages) {
    if (packageInfo.manifest.packageManager) {
      addViolation(
        violations,
        "pnpm-version-duplicate",
        `${packageInfo.relativeDir}/package.json must not declare packageManager`,
        [`${packageInfo.relativeDir}/package.json`, "package.json"],
      );
    }
  }

  const workflowFiles = await listWorkflowFiles(
    path.join(root, ".github", "workflows"),
  );
  for (const workflowPath of workflowFiles) {
    const content = await readFile(workflowPath, "utf8");
    if (!/actions\/setup-node@/u.test(content)) continue;
    const workflowFile = relativePath(root, workflowPath);
    const versionFileMatches = [
      ...content.matchAll(
        /^\s*node-version-file:\s*["']?([^\s"'#]+)["']?\s*$/gmu,
      ),
    ];
    if (versionFileMatches.length === 0) {
      addViolation(
        violations,
        "ci-node-version-file",
        `${workflowFile} must configure setup-node with node-version-file: .node-version`,
        [workflowFile, ".node-version"],
      );
    }
    for (const match of versionFileMatches) {
      if (match[1] !== ".node-version") {
        addViolation(
          violations,
          "ci-node-version-file",
          `${workflowFile} setup-node must use node-version-file: .node-version`,
          [workflowFile, ".node-version"],
        );
      }
    }
    if (/^\s*node-version\s*:/gmu.test(content)) {
      addViolation(
        violations,
        "ci-node-version-inline",
        `${workflowFile} must not inline a Node version beside the canonical file`,
        [workflowFile, ".node-version"],
      );
    }
  }

  const dockerPath = path.join(root, "Dockerfile");
  const dockerfile = await readOptional(dockerPath);
  if (!dockerfile) {
    addViolation(
      violations,
      "docker-node",
      "root Dockerfile must use the Node 22 runtime baseline",
      ["Dockerfile"],
    );
  } else {
    const fromTags = [...dockerfile.matchAll(/^\s*FROM\s+node:([^\s]+)/gmu)];
    if (fromTags.length === 0) {
      addViolation(
        violations,
        "docker-node",
        "root Dockerfile must declare a Node 22 base image",
        ["Dockerfile"],
      );
    }
    for (const match of fromTags) {
      const major = /^([0-9]+)/u.exec(match[1])?.[1];
      if (major !== String(NODE_MAJOR)) {
        addViolation(
          violations,
          "docker-node",
          `Dockerfile Node base image ${match[1]} must use major ${NODE_MAJOR}`,
          ["Dockerfile"],
        );
      }
    }
    if (!/\bcorepack\s+enable\b/u.test(dockerfile)) {
      addViolation(
        violations,
        "docker-corepack",
        "Dockerfile must enable Corepack and follow root packageManager",
        ["Dockerfile", "package.json"],
      );
    }
    if (/\bpnpm@\d+\.\d+\.\d+/u.test(dockerfile)) {
      addViolation(
        violations,
        "pnpm-pin",
        "Dockerfile must not duplicate the root packageManager pnpm version",
        ["Dockerfile", "package.json"],
      );
    }
  }
}

export async function inspectToolchain({
  root = process.cwd(),
  pnpmCommand = "pnpm",
} = {}) {
  const repositoryRoot = path.resolve(root);
  const rootManifest = await readJson(
    path.join(repositoryRoot, "package.json"),
  );
  const workspaceYamlPath = path.join(repositoryRoot, "pnpm-workspace.yaml");
  const workspaceYaml = await readOptional(workspaceYamlPath);
  const violations = [];
  if (workspaceYaml === null) {
    addViolation(
      violations,
      "workspace-manifest",
      "pnpm-workspace.yaml is required for the workspace toolchain policy",
      ["pnpm-workspace.yaml"],
    );
  }
  const catalogInfo = parseDefaultCatalog(workspaceYaml ?? "");
  const workspacePackages = await discoverWorkspacePackages({
    root: repositoryRoot,
    pnpmCommand,
  });

  validateDependencies({
    root: repositoryRoot,
    rootManifest,
    workspacePackages,
    catalogInfo,
    violations,
  });
  await validateRuntime({
    root: repositoryRoot,
    rootManifest,
    workspacePackages,
    violations,
  });

  return {
    root: repositoryRoot,
    workspacePackages,
    catalog: catalogInfo.catalog,
    violations: violations.map(({ key: _key, ...violation }) => violation),
  };
}

export function formatViolations(violations) {
  return violations
    .map((violation) => {
      const location =
        violation.paths.length > 0 ? ` [${violation.paths.join(", ")}]` : "";
      return `- ${violation.code}: ${violation.message}${location}`;
    })
    .join("\n");
}

export async function runToolchainPolicy(options = {}) {
  const result = await inspectToolchain(options);
  if (result.violations.length > 0) {
    console.error(
      `toolchain policy failed with ${result.violations.length} violation(s):\n${formatViolations(result.violations)}`,
    );
    return false;
  }
  console.log(
    `toolchain policy passed: ${result.workspacePackages.length} workspace packages, default catalog, and Node ${NODE_MAJOR}/pnpm baseline`,
  );
  return true;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const passed = await runToolchainPolicy();
    if (!passed) process.exitCode = 1;
  } catch (error) {
    console.error(`toolchain policy could not run: ${error.message}`);
    process.exitCode = 1;
  }
}
