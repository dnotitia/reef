import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const require = createRequire(import.meta.url);
export const BUILD_PROVENANCE_PATH = resolve(
  PACKAGE_ROOT,
  ".next/reef-build.json",
);

// Use the same dependency closure, lockfile, source and environment inputs as
// the canonical build/cache graph rather than maintaining a second file list.
export function getBuildInputHash() {
  const turboBin = require.resolve("turbo/bin/turbo");
  const output = execFileSync(
    process.execPath,
    [turboBin, "run", "build", "--filter=@reef/web", "--dry=json"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const summary = JSON.parse(output.slice(output.indexOf("{")));
  const task = summary.tasks.find(
    (candidate) => candidate.taskId === "@reef/web#build",
  );
  if (!task || !/^[a-f0-9]{16}$/u.test(task.hash)) {
    throw new Error("Turbo did not supply the production build input hash");
  }
  return task.hash;
}

export async function readBuildId() {
  return (
    await readFile(resolve(PACKAGE_ROOT, ".next/BUILD_ID"), "utf8")
  ).trim();
}

export async function assertCurrentProductionBuild() {
  let provenance;
  try {
    provenance = JSON.parse(await readFile(BUILD_PROVENANCE_PATH, "utf8"));
  } catch {
    throw new Error(
      "Missing or invalid production build provenance; run pnpm run build before reusing E2E artifacts",
    );
  }
  if (
    provenance?.version !== 1 ||
    !/^[a-f0-9]{16}$/u.test(provenance.inputHash) ||
    typeof provenance.buildId !== "string"
  ) {
    throw new Error("Invalid production build provenance; run pnpm run build");
  }
  if (
    provenance.nodeVersion !== process.version ||
    provenance.platform !== process.platform ||
    provenance.arch !== process.arch
  ) {
    throw new Error(
      "The production build runtime differs from this runtime; run pnpm run build",
    );
  }
  if (provenance.inputHash !== getBuildInputHash()) {
    throw new Error(
      "The production build inputs changed; run pnpm run build before reusing E2E artifacts",
    );
  }
  const buildIds = await Promise.all([
    readBuildId(),
    readFile(
      resolve(PACKAGE_ROOT, ".next/standalone/packages/web/.next/BUILD_ID"),
      "utf8",
    ).then((value) => value.trim()),
  ]);
  if (buildIds.some((buildId) => buildId !== provenance.buildId)) {
    throw new Error(
      "The production build ID differs from its provenance; run pnpm run build",
    );
  }
}
