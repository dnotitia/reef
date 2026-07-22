import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = resolve(srcRoot, "..");

type ModuleName =
  | "accounts"
  | "archive"
  | "cli"
  | "content"
  | "entry"
  | "execution"
  | "issues"
  | "jira"
  | "planning"
  | "related"
  | "shared";

const flatModuleByFile: Readonly<Record<string, ModuleName>> = {
  "cli.ts": "entry",
  "index.ts": "entry",
  "issueMapping.ts": "issues",
  "ledger.ts": "execution",
  "payloads.ts": "jira",
  "rawArchive.ts": "archive",
  "relatedImport.ts": "related",
};

const allowedDependencies: Readonly<Record<ModuleName, readonly ModuleName[]>> =
  {
    accounts: ["accounts", "jira"],
    archive: ["archive", "shared"],
    cli: ["cli", "jira", "shared"],
    content: ["accounts", "archive", "content", "shared"],
    entry: [
      "accounts",
      "archive",
      "cli",
      "content",
      "entry",
      "execution",
      "issues",
      "jira",
      "planning",
      "related",
      "shared",
    ],
    execution: ["archive", "execution", "shared"],
    issues: [
      "accounts",
      "archive",
      "content",
      "execution",
      "issues",
      "jira",
      "planning",
      "shared",
    ],
    jira: ["jira", "shared"],
    planning: ["jira", "planning", "shared"],
    related: ["accounts", "content", "execution", "jira", "related", "shared"],
    shared: ["shared"],
  };

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith(".ts") && !path.endsWith(".test.ts")
      ? [path]
      : [];
  });

const moduleFor = (file: string): ModuleName => {
  const path = relative(srcRoot, file);
  const [first] = path.split(sep);
  if (path.includes(sep)) return first as ModuleName;
  const moduleName = flatModuleByFile[path];
  if (!moduleName) throw new Error(`unowned jira-migrator source: ${path}`);
  return moduleName;
};

const relativeImports = (source: string): string[] =>
  [
    ...source.matchAll(/(?:from\s+|import\s*\()\s*["'](\.\.?\/[^"']+)["']/gu),
  ].map((match) => match[1] as string);

const importedFile = (sourceFile: string, specifier: string): string =>
  resolve(
    dirname(sourceFile),
    specifier.endsWith(".js")
      ? `${specifier.slice(0, -".js".length)}.ts`
      : specifier,
  );

describe("jira-migrator module boundaries", () => {
  it("keeps the package root as the only package export", () => {
    const packageJson = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { exports?: Record<string, unknown> };

    expect(Object.keys(packageJson.exports ?? {})).toEqual(["."]);
  });

  it("keeps runtime imports inside the allowed dependency graph", () => {
    const violations = sourceFiles(srcRoot).flatMap((sourceFile) => {
      const sourceModule = moduleFor(sourceFile);
      return relativeImports(readFileSync(sourceFile, "utf8")).flatMap(
        (specifier) => {
          const targetFile = importedFile(sourceFile, specifier);
          if (!targetFile.startsWith(`${srcRoot}${sep}`)) return [];
          const targetModule = moduleFor(targetFile);
          return allowedDependencies[sourceModule].includes(targetModule)
            ? []
            : [
                {
                  source: relative(srcRoot, sourceFile),
                  sourceModule,
                  target: relative(srcRoot, targetFile),
                  targetModule,
                },
              ];
        },
      );
    });

    expect(violations).toEqual([]);
  });

  it("keeps internal module dependencies acyclic", () => {
    const graph = new Map<ModuleName, Set<ModuleName>>();
    for (const sourceFile of sourceFiles(srcRoot)) {
      const sourceModule = moduleFor(sourceFile);
      if (sourceModule === "entry") continue;
      const dependencies = graph.get(sourceModule) ?? new Set<ModuleName>();
      for (const specifier of relativeImports(
        readFileSync(sourceFile, "utf8"),
      )) {
        const targetFile = importedFile(sourceFile, specifier);
        if (!targetFile.startsWith(`${srcRoot}${sep}`)) continue;
        const targetModule = moduleFor(targetFile);
        if (targetModule !== sourceModule && targetModule !== "entry") {
          dependencies.add(targetModule);
        }
      }
      graph.set(sourceModule, dependencies);
    }

    const visited = new Set<ModuleName>();
    const active = new Set<ModuleName>();
    const cycles: ModuleName[][] = [];
    const visit = (moduleName: ModuleName, path: ModuleName[]): void => {
      if (active.has(moduleName)) {
        cycles.push([...path.slice(path.indexOf(moduleName)), moduleName]);
        return;
      }
      if (visited.has(moduleName)) return;
      active.add(moduleName);
      for (const dependency of graph.get(moduleName) ?? []) {
        visit(dependency, [...path, moduleName]);
      }
      active.delete(moduleName);
      visited.add(moduleName);
    };

    for (const moduleName of graph.keys()) visit(moduleName, []);
    expect(cycles).toEqual([]);
  });
});
