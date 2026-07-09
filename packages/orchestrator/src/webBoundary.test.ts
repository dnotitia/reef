import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
);
const apiRoot = join(repoRoot, "packages", "web", "src", "app", "api");

const routeFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.isFile() && entry.name === "route.ts" ? [path] : [];
  });

const forbiddenLongRunningRoutePatterns = [
  /\bsetInterval\s*\(/,
  /\bsetTimeout\s*\(/,
  /\bwhile\s*\(\s*true\s*\)/,
  /\bfor\s*\(\s*;\s*;\s*\)/,
  /\bpollInterval\b/,
];

describe("web Route Handler boundary", () => {
  it("keeps worker polling and long-running orchestration loops outside Route Handlers", () => {
    const offenders = routeFiles(apiRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return forbiddenLongRunningRoutePatterns
        .filter((pattern) => pattern.test(source))
        .map((pattern) => ({
          file: relative(repoRoot, file),
          pattern: pattern.source,
        }));
    });

    expect(offenders).toEqual([]);
  });
});
