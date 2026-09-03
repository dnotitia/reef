#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = process.argv[2] ?? process.env.REEF_RELEASE_MANIFEST;
const corePath = path.join(root, "packages", "core", "dist", "index.js");

function fail(message) {
  throw new Error(message);
}

async function main() {
  if (!inputPath) {
    fail(
      "A finalized release payload path is required as the first argument or REEF_RELEASE_MANIFEST",
    );
  }
  const core = await import(pathToFileURL(corePath).href).catch((error) => {
    throw new Error(
      `Could not load the built @reef/core artifact; run its build before this gate: ${error.message}`,
    );
  });
  const payload = JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
  const verified = await core.verifyFinalizedRelease(payload);
  if (core.canonicalJson(payload) !== core.canonicalJson(verified)) {
    fail("Finalized release payload is not in canonical form");
  }
  console.log(
    `release manifest check passed: v${verified.version}, source ${verified.manifest.source_revision}, checksum ${verified.manifest_checksum}`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`release manifest check failed: ${error.message}`);
  process.exitCode = 1;
}
