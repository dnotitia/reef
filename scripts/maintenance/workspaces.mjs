import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const WORKSPACE_LIST_ARGS = ["--recursive", "list", "--depth=-1", "--json"];

function pathStepKey(packageDir) {
  return path.basename(packageDir).replace(/[^a-zA-Z0-9-]/g, "-");
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(packageDir) {
  const manifestPath = path.join(packageDir, "package.json");
  let content;
  try {
    content = await readFile(manifestPath, "utf8");
  } catch (error) {
    throw new Error(
      `pnpm listed a workspace package without a readable package.json at ${manifestPath}: ${error.message}`,
    );
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Invalid workspace package manifest at ${manifestPath}: ${error.message}`,
    );
  }
}

function listFromPnpm(root, pnpmCommand) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpmCommand, WORKSPACE_LIST_ARGS, {
      cwd: root,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code !== 0) {
        const detail = stderr.join("").trim();
        reject(
          new Error(
            `pnpm workspace discovery failed with exit code ${code}${detail ? `: ${detail}` : ""}`,
          ),
        );
        return;
      }
      resolve(stdout.join(""));
    });
  });
}

export async function discoverWorkspacePackages({
  root,
  pnpmCommand = "pnpm",
}) {
  const repositoryRoot = path.resolve(root);
  const output = await listFromPnpm(repositoryRoot, pnpmCommand);
  let entries;
  try {
    entries = JSON.parse(output);
  } catch (error) {
    throw new Error(
      `pnpm workspace discovery returned invalid JSON: ${error.message}`,
    );
  }
  if (!Array.isArray(entries)) {
    throw new Error("pnpm workspace discovery returned a non-array JSON value");
  }

  const seen = new Set();
  const packages = [];
  for (const entry of entries) {
    if (!entry || typeof entry.path !== "string") continue;
    const packageDir = path.resolve(entry.path);
    const relativeDir = path.relative(repositoryRoot, packageDir);
    if (relativeDir === "") continue;
    if (relativeDir.startsWith("..") || path.isAbsolute(relativeDir)) {
      throw new Error(
        `pnpm listed a workspace package outside the repository: ${entry.path}`,
      );
    }
    if (seen.has(packageDir)) continue;
    seen.add(packageDir);

    const manifest = await readManifest(packageDir);
    packages.push({
      dir: packageDir,
      key: pathStepKey(packageDir),
      manifest,
      name:
        typeof manifest.name === "string" && manifest.name
          ? manifest.name
          : typeof entry.name === "string" && entry.name
            ? entry.name
            : relativeDir,
      relativeDir,
      srcRoot: (await pathExists(path.join(packageDir, "src")))
        ? path.join(relativeDir, "src")
        : null,
      testRoot: (await pathExists(path.join(packageDir, "tests")))
        ? path.join(relativeDir, "tests")
        : null,
    });
  }

  packages.sort((left, right) =>
    left.relativeDir.localeCompare(right.relativeDir),
  );
  return packages;
}
