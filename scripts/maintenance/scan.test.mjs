import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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
