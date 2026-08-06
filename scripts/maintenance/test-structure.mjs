import { readFile, readdir } from "node:fs/promises";
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

export const OBSOLETE_SUPPRESSION_KEYS = [
  "packages/jira-migrator/src/related/import.test.ts",
  "packages/jira-migrator/src/runner/targetAdapter.test.ts",
  "packages/core/src/adapters/akb.issue-activity.test.ts",
  "packages/jira-migrator/src/runner/runner.test.ts",
  "packages/core/src/adapters/akb/issues/issues.test.ts",
];

export const OBSOLETE_SPLIT_FILES = [
  "packages/jira-migrator/src/related/import.test.ts",
  "packages/jira-migrator/src/runner/targetAdapter.test.ts",
  "packages/core/src/adapters/akb.issue-activity.test.ts",
  "packages/jira-migrator/src/runner/runner.test.ts",
  "packages/core/src/adapters/akb/issues/issues.test.ts",
];

export const SPLIT_TEST_FILES = [
  "packages/jira-migrator/src/related/import-comments-baseline.test.ts",
  "packages/jira-migrator/src/related/import-comments-visibility.test.ts",
  "packages/jira-migrator/src/related/import-attachments.test.ts",
  "packages/jira-migrator/src/related/import-remote-links.test.ts",
  "packages/jira-migrator/src/related/import-relations.test.ts",
  "packages/jira-migrator/src/related/import-relation-readback.test.ts",
  "packages/jira-migrator/src/related/media-crosswalk.test.ts",
  "packages/jira-migrator/src/related/directional-link.test.ts",
  "packages/jira-migrator/src/runner/runner-plan.test.ts",
  "packages/jira-migrator/src/runner/runner-apply.test.ts",
  "packages/jira-migrator/src/runner/targetAdapter-issues.test.ts",
  "packages/jira-migrator/src/runner/targetAdapter-readback.test.ts",
  "packages/jira-migrator/src/runner/targetAdapter-related.test.ts",
  "packages/core/src/adapters/akb/issues/issue-activity-events.test.ts",
  "packages/core/src/adapters/akb/issues/issue-activity-fields.test.ts",
  "packages/core/src/adapters/akb/issues/issues-update.test.ts",
  "packages/core/src/adapters/akb/issues/issues-backlog.test.ts",
];

const LARGE_FILE_LIMIT = 700;

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

async function exists(file) {
  try {
    await readFile(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function validateTestLayout({
  root = process.cwd(),
  splitTestFiles = SPLIT_TEST_FILES,
  obsoleteSplitFiles = OBSOLETE_SPLIT_FILES,
  obsoleteSuppressionKeys = OBSOLETE_SUPPRESSION_KEYS,
} = {}) {
  const errors = [];
  const e2eRoot = path.join(root, "packages/web/tests/e2e");
  const adapterRoot = path.join(root, "packages/core/src/adapters");
  const scanFile = path.join(root, "scripts/maintenance/scan.mjs");
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

  const suppressionSource = await readFile(scanFile, "utf8");
  for (const key of obsoleteSuppressionKeys) {
    if (suppressionSource.includes(`"${key}"`)) {
      errors.push(`Obsolete large-file suppression remains: ${key}`);
    }
  }

  for (const file of obsoleteSplitFiles) {
    if (await exists(path.join(root, file))) {
      errors.push(`Obsolete unsplit test remains: ${file}`);
    }
  }

  const splitFileLineCounts = {};
  for (const file of splitTestFiles) {
    const absolute = path.join(root, file);
    if (!(await exists(absolute))) {
      errors.push(`Expected split test is missing: ${file}`);
      continue;
    }
    const source = await readFile(absolute, "utf8");
    const lineCount =
      source.split(/\r?\n/).length - (source.endsWith("\n") ? 1 : 0);
    splitFileLineCounts[file] = lineCount;
    if (lineCount >= LARGE_FILE_LIMIT) {
      errors.push(
        `Split test must stay below ${LARGE_FILE_LIMIT} lines: ${file} (${lineCount})`,
      );
    }
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
    splitFileLineCounts,
  };
}
