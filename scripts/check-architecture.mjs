import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { discoverWorkspacePackages } from "./maintenance/workspaces.mjs";

const root = process.cwd();
const workspacePackages = await discoverWorkspacePackages({ root });
if (workspacePackages.length === 0) {
  throw new Error("Workspace discovery returned no packages");
}

const sourceRoots = workspacePackages
  .filter((packageInfo) => packageInfo.srcRoot)
  .map((packageInfo) => path.join(root, packageInfo.srcRoot));

const obsoleteSchemaApi =
  /\b(?:ensureReefTables|akbEnsureReefTables|alterAkbTable|akbAlterTable|applyAkbTableMigration|akbApplyTableMigration|dropAkbTable|AkbTableMigrationOperation|REEF_SETTINGS_SCHEMA_VERSION_KEY)\b/u;
const tableSchemaMutationRequest =
  /(?:\.request|\bfetch)\s*\(\s*(`[^`]*\/api\/v1\/tables\/[^`]*`|["'][^"']*\/api\/v1\/tables\/[^"']*["'])\s*,\s*\{[\s\S]{0,240}?\bmethod\s*:\s*["'](?:POST|PATCH|DELETE)["']/iu;
const tableDdl = /\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+TABLE\b/iu;
// Endpoints without one workspace to preflight use the request adapter
// directly. My Work resolves every accessible workspace and checks readiness
// before its single cross-vault query; the remaining entries are identity or
// workspace setup/lifecycle routes.
const rawAdapterRoutes = new Set([
  "packages/web/src/app/api/auth/akb/me/route.ts",
  "packages/web/src/app/api/users/search/route.ts",
  "packages/web/src/app/api/my-work/route.ts",
  "packages/web/src/app/api/vaults/route.ts",
  "packages/web/src/app/api/vaults/[vault]/installation/route.ts",
  "packages/web/src/app/api/vaults/[vault]/members/route.ts",
  "packages/web/src/app/api/vaults/[vault]/members/[user]/route.ts",
  "packages/web/src/app/api/vaults/[vault]/route.ts",
  "packages/web/src/app/api/vaults/[vault]/skill/route.ts",
]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(filePath);
      if (
        !entry.isFile() ||
        !/\.(?:c|m)?(?:j|t)sx?$/u.test(entry.name) ||
        /\.(?:test|spec)\.[^.]+$/u.test(entry.name)
      ) {
        return [];
      }
      return [filePath];
    }),
  );
  return paths.flat();
}

const schemaGuardFailures = [];
for (const sourceRoot of sourceRoots) {
  for (const filePath of await sourceFiles(sourceRoot)) {
    const relativePath = path
      .relative(root, filePath)
      .split(path.sep)
      .join("/");
    const content = await readFile(filePath, "utf8");
    const isAkbAdapterSource = relativePath.startsWith(
      "packages/core/src/adapters/akb/",
    );
    if (obsoleteSchemaApi.test(content)) {
      schemaGuardFailures.push(
        `${relativePath}: obsolete Reef table mutation or schema-stamp API`,
      );
    }
    const tableMutationRequest = content.match(tableSchemaMutationRequest)?.[1];
    if (
      (tableMutationRequest && !/\/sql[`'"]/iu.test(tableMutationRequest)) ||
      tableDdl.test(content)
    ) {
      schemaGuardFailures.push(
        `${relativePath}: Reef runtime source contains a table schema mutation`,
      );
    }
    if (isAkbAdapterSource && /["']schema_version["']/u.test(content)) {
      schemaGuardFailures.push(
        `${relativePath}: Reef AKB adapter reads or writes a local schema stamp`,
      );
    }
    if (
      relativePath.startsWith("packages/web/src/app/api/") &&
      /\bgetAkbAdapter\s*\(/u.test(content) &&
      !rawAdapterRoutes.has(relativePath)
    ) {
      schemaGuardFailures.push(
        `${relativePath}: product API route bypasses getWorkspaceAkbAdapter`,
      );
    }
  }
}

if (schemaGuardFailures.length > 0) {
  throw new Error(
    `Reef runtime schema guard failed:\n${schemaGuardFailures.map((failure) => `- ${failure}`).join("\n")}`,
  );
}

const result = spawnSync(
  "pnpm",
  [
    "exec",
    "depcruise",
    "--config",
    "dependency-cruiser.cjs",
    "--output-type",
    "err",
    "--progress",
    "none",
    ...sourceRoots,
  ],
  { cwd: root, stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  console.log(
    `architecture and Reef runtime schema checks passed: ${sourceRoots.length} workspace source roots`,
  );
}
