// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const ENTRYPOINTS = [
  "package.json",
  "playwright.config.ts",
  "scripts/dev-e2e.mjs",
  "scripts/e2e-shards.mjs",
  "scripts/build.mjs",
];
const BUNDLER_OVERRIDES = ["--webpack", "--turbopack"];

function findBundlerOverrides(source: string) {
  return BUNDLER_OVERRIDES.filter((flag) => source.includes(flag));
}

describe("Next.js bundler contract", () => {
  it("keeps the default dev port and bundler across web entrypoints", async () => {
    const sources = await Promise.all(
      ENTRYPOINTS.map((entrypoint) =>
        readFile(resolve(PACKAGE_ROOT, entrypoint), "utf8"),
      ),
    );

    expect(JSON.parse(sources[0]).scripts.dev).toMatch(
      /(?:^|\s)(?:-p|--port)(?:\s+|=)7333(?:\s|$)/u,
    );
    expect(sources.flatMap(findBundlerOverrides)).toEqual([]);
  });
});
