import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  OBSOLETE_SUPPRESSION_KEYS,
  validateTestLayout,
} from "./test-structure.mjs";
import { discoverWorkspacePackages } from "./workspaces.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

test("discovers nested pnpm workspaces without recursive package.json guesses", async () => {
  const packages = await discoverWorkspacePackages({ root: ROOT });
  const packageDirs = new Set(packages.map(({ relativeDir }) => relativeDir));

  assert.ok(packageDirs.has("packages/orchestration/runtime"));
  assert.ok(packageDirs.has("packages/orchestration/providers/reef"));
  assert.ok(packageDirs.has("packages/orchestration/providers/codex"));
  assert.ok(!packageDirs.has("scripts/maintenance/fixtures/non-workspace"));
});

test("keeps the repository test layout within its approved domains", async () => {
  const result = await validateTestLayout();

  assert.deepEqual(result.errors, []);
  assert.equal(result.counts.rootE2eHermeticSpecs, 0);
  assert.equal(result.counts.hermeticSpecs, 47);
  assert.equal(result.counts.rootAdapterTests, 0);
  assert.equal(result.counts.rootAdapterFixtures, 0);
  assert.equal(result.counts.rootAdapterSupport, 0);
});

async function writeFixture(root, relativePath, content) {
  const file = path.join(root, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

test("accepts a positive test-layout fixture", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "reef-test-layout-positive-"),
  );
  try {
    const splitTest = "packages/core/src/adapters/akb/issues/split.test.ts";
    await writeFixture(
      root,
      "packages/web/tests/e2e/issues/example.hermetic.spec.ts",
      "test();\n",
    );
    await writeFixture(
      root,
      "packages/core/src/adapters/akb/issues/example.test.ts",
      "test();\n",
    );
    await writeFixture(root, splitTest, "test();\n");
    await writeFixture(
      root,
      "scripts/maintenance/scan.mjs",
      "const suppressions = new Map();\n",
    );

    const result = await validateTestLayout({
      root,
      splitTestFiles: [splitTest],
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.counts.hermeticSpecs, 1);
    assert.equal(result.splitFileLineCounts[splitTest], 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects root specs, root adapter files, suppressions, and oversized splits", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "reef-test-layout-negative-"),
  );
  try {
    const splitTest = "packages/core/src/adapters/akb/issues/split.test.ts";
    const obsoleteKey = OBSOLETE_SUPPRESSION_KEYS[0];
    await writeFixture(
      root,
      "packages/web/tests/e2e/legacy.hermetic.spec.ts",
      "test();\n",
    );
    await writeFixture(
      root,
      "packages/core/src/adapters/akb.legacy.test.ts",
      "test();\n",
    );
    await writeFixture(
      root,
      "packages/core/src/adapters/akb.legacyFixtures.ts",
      "export const fixture = true;\n",
    );
    await writeFixture(
      root,
      "packages/core/src/adapters/akb.testSupport.ts",
      "export const support = true;\n",
    );
    await writeFixture(
      root,
      splitTest,
      `${Array.from({ length: 700 }, () => "test();").join("\n")}\n`,
    );
    await writeFixture(
      root,
      "scripts/maintenance/scan.mjs",
      `const obsolete = "${obsoleteKey}";\n`,
    );

    const result = await validateTestLayout({
      root,
      splitTestFiles: [splitTest],
    });

    assert.ok(
      result.errors.some((error) =>
        error.includes("outside an approved domain"),
      ),
    );
    assert.ok(result.errors.some((error) => error.includes("root")));
    assert.equal(result.counts.rootAdapterTests, 1);
    assert.equal(result.counts.rootAdapterFixtures, 1);
    assert.equal(result.counts.rootAdapterSupport, 1);
    assert.ok(
      result.errors.some((error) =>
        error.includes("Obsolete large-file suppression"),
      ),
    );
    assert.ok(result.errors.some((error) => error.includes("below 700 lines")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
