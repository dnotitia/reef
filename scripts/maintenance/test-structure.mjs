import { readdir } from "node:fs/promises";
import path from "node:path";

export const APPROVED_E2E_DOMAINS = [
  "auth",
  "issues",
  "activity",
  "search",
  "workspace",
  "settings",
  "planning",
  "system",
];

async function listFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...(await listFiles(entryPath)));
      else if (entry.isFile()) files.push(entryPath);
    }
    return files;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readDirectory(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function validateTestLayout({ root = process.cwd() } = {}) {
  const errors = [];
  const e2eRoot = path.join(root, "packages/web/tests/e2e");
  const adapterRoot = path.join(root, "packages/core/src/adapters");
  const hermeticFiles = (await listFiles(e2eRoot)).filter((file) =>
    file.endsWith(".hermetic.spec.ts"),
  );
  const approvedDomains = new Set(APPROVED_E2E_DOMAINS);
  for (const file of hermeticFiles) {
    const relative = path.relative(e2eRoot, file);
    const [domain] = relative.split(path.sep);
    if (!domain || !approvedDomains.has(domain)) {
      errors.push(
        `E2E hermetic spec is outside an approved domain: ${relative}`,
      );
    }
  }

  const rootAdapterEntries = await readDirectory(adapterRoot);
  const rootAdapterTestFiles = rootAdapterEntries
    .filter((entry) => entry.isFile() && /^akb\..+\.test\.ts$/.test(entry.name))
    .map((entry) => entry.name);
  const rootAdapterFixtureFiles = rootAdapterEntries
    .filter(
      (entry) => entry.isFile() && /^akb\..+Fixtures\.ts$/.test(entry.name),
    )
    .map((entry) => entry.name);
  const rootAdapterSupportFiles = rootAdapterEntries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^akb\..*(?:TestSupport|testSupport)\.ts$/.test(entry.name),
    )
    .map((entry) => entry.name);
  for (const file of [
    ...rootAdapterTestFiles,
    ...rootAdapterFixtureFiles,
    ...rootAdapterSupportFiles,
  ]) {
    errors.push(`AKB adapter test support remains at the root: ${file}`);
  }

  return {
    errors,
    counts: {
      rootE2eHermeticSpecs: hermeticFiles.filter(
        (file) => path.dirname(path.relative(e2eRoot, file)) === ".",
      ).length,
      hermeticSpecs: hermeticFiles.length,
      rootAdapterTests: rootAdapterTestFiles.length,
      rootAdapterFixtures: rootAdapterFixtureFiles.length,
      rootAdapterSupport: rootAdapterSupportFiles.length,
    },
  };
}
