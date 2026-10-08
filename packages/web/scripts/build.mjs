#!/usr/bin/env node

import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  BUILD_PROVENANCE_PATH,
  getBuildInputHash,
  readBuildId,
} from "./production-build.mjs";

await rm(BUILD_PROVENANCE_PATH, { force: true });
const inputHash = getBuildInputHash();
const require = createRequire(import.meta.url);
const child = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "build", ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
const code = await new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});
if (code !== 0) process.exit(code);
if (inputHash !== getBuildInputHash()) {
  throw new Error(
    "Production inputs changed during the build; run pnpm run build again",
  );
}
await writeFile(
  BUILD_PROVENANCE_PATH,
  `${JSON.stringify({
    version: 1,
    inputHash,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    buildId: await readBuildId(),
  })}\n`,
);
