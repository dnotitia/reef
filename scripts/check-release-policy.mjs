#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

function readText(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function requireFile(relativePath) {
  if (!existsSync(path.join(root, relativePath))) {
    errors.push(`Missing required release-policy file: ${relativePath}`);
    return false;
  }
  return true;
}

function changedFiles() {
  const files = new Set();
  const commands = [];
  if (process.env.GITHUB_BASE_REF) {
    commands.push([
      "diff",
      "--name-only",
      `origin/${process.env.GITHUB_BASE_REF}...HEAD`,
      "--",
    ]);
  }
  if (process.env.GITHUB_EVENT_BEFORE) {
    commands.push([
      "diff",
      "--name-only",
      `${process.env.GITHUB_EVENT_BEFORE}...HEAD`,
      "--",
    ]);
  }
  commands.push(
    ["diff", "--name-only", "HEAD", "--"],
    ["diff", "--name-only", "--cached", "--"],
    ["ls-files", "--others", "--exclude-standard"],
  );
  for (const args of commands) {
    try {
      const output = execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const file of output.split("\n")) {
        if (file.trim()) files.add(file.trim());
      }
    } catch {
      // Keep the check useful outside git worktrees; static checks still run.
    }
  }
  return files;
}

function unreleasedSection(changelog) {
  const match = changelog.match(/## Unreleased\n([\s\S]*?)(?:\n## |\s*$)/);
  return match?.[1] ?? null;
}

function mentions(section, patterns) {
  return patterns.some((pattern) => pattern.test(section));
}

function checkVersionSource() {
  const rootPackage = readJson("package.json");
  const semver =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  if (!semver.test(String(rootPackage.version ?? ""))) {
    errors.push("Root package.json must define the product SemVer version.");
  }

  for (const packagePath of [
    "packages/web/package.json",
    "packages/core/package.json",
  ]) {
    const pkg = readJson(packagePath);
    if (Object.hasOwn(pkg, "version")) {
      errors.push(
        `${packagePath} must not define version; root package.json is the product version source.`,
      );
    }
  }
}

function checkRequiredDocs() {
  for (const file of [
    "CHANGELOG.md",
    "docs/release-policy.md",
    "docs/migration-policy.md",
  ]) {
    requireFile(file);
  }
}

function checkNoAdHocAkbSqlMigrations() {
  const migrationDir = path.join(root, "deploy/migrations");
  if (!existsSync(migrationDir)) return;
  const sqlFiles = readdirSync(migrationDir).filter((file) =>
    file.endsWith(".sql"),
  );
  if (sqlFiles.length > 0) {
    errors.push(
      `Do not commit ad hoc akb SQL migrations in deploy/migrations: ${sqlFiles.join(", ")}`,
    );
  }
}

function checkMigrationChangelogCoverage(files) {
  if (!existsSync(path.join(root, "CHANGELOG.md"))) return;
  const section = unreleasedSection(readText("CHANGELOG.md"));
  if (section == null) {
    errors.push("CHANGELOG.md must contain an Unreleased section.");
    return;
  }

  const changed = (file) => files.has(file);

  if (
    changed("packages/core/src/adapters/akb/vaultSkill.ts") &&
    !mentions(section, [/vault skill/i, /runbook/i])
  ) {
    errors.push(
      "vaultSkill.ts changed; CHANGELOG.md Unreleased must mention vault skill/runbook migration impact.",
    );
  }

  if (
    changed("packages/web/src/lib/storage/db.ts") &&
    !mentions(section, [/dexie/i, /indexeddb/i, /browser storage/i])
  ) {
    errors.push(
      "Dexie schema changed; CHANGELOG.md Unreleased must mention browser storage migration impact.",
    );
  }

  if (
    changed("packages/web/src/providers/QueryProvider.tsx") &&
    !mentions(section, [/cache/i, /persist/i, /buster/i])
  ) {
    errors.push(
      "Persisted query cache code changed; CHANGELOG.md Unreleased must mention cache migration impact.",
    );
  }
}

checkVersionSource();
checkRequiredDocs();
checkNoAdHocAkbSqlMigrations();
checkMigrationChangelogCoverage(changedFiles());

if (errors.length > 0) {
  console.error("Release policy check failed:\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Release policy check passed.");
