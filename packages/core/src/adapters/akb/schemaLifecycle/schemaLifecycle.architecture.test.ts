// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../..",
);

function productionFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (entry === "node_modules" || entry === "dist" || entry === ".next")
      continue;
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...productionFiles(path));
    else if (
      /\.(?:ts|tsx|mjs)$/.test(entry) &&
      !entry.includes(".test.") &&
      !path.includes(`${join("packages", "web", "tests")}/`) &&
      !path.includes("testSupport")
    ) {
      files.push(path);
    }
  }
  return files;
}

describe("schema lifecycle architecture", () => {
  it("allows reconcile calls only in the primitive and two application owners", () => {
    const callers = productionFiles(join(REPO_ROOT, "packages"))
      .filter((path) =>
        /reconcileWorkspaceSchema\s*\(/.test(readFileSync(path, "utf8")),
      )
      .map((path) => relative(REPO_ROOT, path))
      .sort();
    expect(callers).toEqual([
      "packages/core/src/adapters/akb/core/tables.ts",
      "packages/core/src/adapters/akb/schemaLifecycle/startup.ts",
      "packages/core/src/adapters/akb/workspace/initialization.ts",
    ]);
  });

  it("has no production legacy lazy provisioning call", () => {
    const callers = productionFiles(join(REPO_ROOT, "packages"))
      .filter((path) =>
        /ensureReefTables\s*\(/.test(readFileSync(path, "utf8")),
      )
      .map((path) => relative(REPO_ROOT, path));
    expect(callers).toEqual([]);
  });
});
