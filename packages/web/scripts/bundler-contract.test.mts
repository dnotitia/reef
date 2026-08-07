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
];
const BUNDLER_OVERRIDES = ["--webpack", "--turbopack"];

function findBundlerOverrides(source: string) {
  return BUNDLER_OVERRIDES.filter((flag) => source.includes(flag));
}

describe("Next.js bundler contract", () => {
  it("uses the default bundler across every web entrypoint", async () => {
    const sources = await Promise.all(
      ENTRYPOINTS.map((entrypoint) =>
        readFile(resolve(PACKAGE_ROOT, entrypoint), "utf8"),
      ),
    );

    expect(JSON.parse(sources[0]).scripts).toMatchObject({
      dev: "next dev -p 7333",
      build: "next build",
    });
    expect(sources[1]).toContain("next dev -p");
    expect(sources[2]).toContain('"exec", "next", "dev", "-p"');
    expect(sources[3]).toMatch(/"exec",\s*"turbo",\s*"run",\s*"build"/u);
    expect(sources.slice(1).flatMap(findBundlerOverrides)).toEqual([]);
  });

  it.each(BUNDLER_OVERRIDES)("detects an explicit %s override", (flag) => {
    expect(findBundlerOverrides(`next build ${flag}`)).toEqual([flag]);
  });
});
