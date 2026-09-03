#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blueprintPath = path.join(root, "release", "reef-release-blueprint.json");
const corePath = path.join(root, "packages", "core", "dist", "index.js");

function fail(message) {
  throw new Error(message);
}

async function main() {
  const core = await import(pathToFileURL(corePath).href).catch((error) => {
    throw new Error(
      `Could not load the built @reef/core artifact; run its build before this gate: ${error.message}`,
    );
  });
  const committed = JSON.parse(await readFile(blueprintPath, "utf8"));
  const parsed = core.ReleaseBlueprintSchema.parse(committed);
  const generated = await core.buildReleaseBlueprint();
  if (core.canonicalJson(parsed) !== core.canonicalJson(generated)) {
    fail("Committed Reef Release Blueprint drifted from the schema SSOT");
  }
  if (generated.schema.tables.length !== 12) {
    fail("Reef Release Blueprint must contain all twelve desired tables");
  }
  console.log(
    `release blueprint check passed: schema v${generated.schema_version}, ${generated.schema.tables.length} tables, fingerprint ${generated.schema.fingerprint}`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`release blueprint check failed: ${error.message}`);
  process.exitCode = 1;
}
