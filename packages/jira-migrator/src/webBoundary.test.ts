import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const srcRoot = join(packageRoot, "src");
const forbiddenRuntimeDeps = ["@reef/web", "next", "react", "react-dom"];

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith(".ts") && !path.endsWith(".test.ts")
      ? [path]
      : [];
  });

describe("jira-migrator runtime boundary", () => {
  it("does not depend on web, Next.js, or React runtime packages", () => {
    const packageJson = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const runtimeDeps = Object.keys(packageJson.dependencies ?? {});

    expect(
      runtimeDeps.filter((dependency) =>
        forbiddenRuntimeDeps.includes(dependency),
      ),
    ).toEqual([]);
  });

  it("keeps runtime source imports outside web and Route Handler surfaces", () => {
    const offenders = sourceFiles(srcRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [
        /from\s+["']@reef\/web["']/,
        /from\s+["']next(?:\/|["'])/,
        /from\s+["']react(?:\/|["'])/,
        /packages\/web/,
        /route\.ts/,
      ]
        .filter((pattern) => pattern.test(source))
        .map((pattern) => ({
          file: relative(packageRoot, file),
          pattern: pattern.source,
        }));
    });

    expect(offenders).toEqual([]);
  });
});
