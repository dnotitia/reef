// @vitest-environment node

import { execFileSync, spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const turboBin = join(repoRoot, "node_modules/.bin/turbo");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "reef-build-reuse-"));
  temporaryDirectories.push(root);
  const web = join(root, "packages/web");
  await mkdir(join(web, "node_modules/.bin"), { recursive: true });
  await mkdir(join(root, "node_modules/.bin"), { recursive: true });
  await symlink(turboBin, join(root, "node_modules/.bin/turbo"));
  await symlink(
    join(repoRoot, "node_modules/turbo"),
    join(root, "node_modules/turbo"),
    "junction",
  );
  await mkdir(join(web, "scripts"));
  await Promise.all(
    ["e2e-shards.mjs", "production-build.mjs", "build.mjs"].map((name) =>
      cp(join(packageRoot, "scripts", name), join(web, "scripts", name)),
    ),
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, packageManager: "pnpm@11.10.0" }),
  );
  await writeFile(
    join(root, "pnpm-workspace.yaml"),
    "packages:\n  - packages/*\n",
  );
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/core: {}\n  packages/web:\n    dependencies:\n      '@reef/core':\n        specifier: workspace:*\n        version: link:../core\n",
  );
  await writeFile(
    join(root, "turbo.json"),
    JSON.stringify({
      globalDependencies: ["package.json"],
      tasks: {
        build: {
          dependsOn: ["^build"],
          inputs: ["$TURBO_DEFAULT$", ".env*"],
          outputs: [".next/**"],
          env: ["NEXT_PUBLIC_*"],
        },
      },
    }),
  );
  await writeFile(
    join(web, "package.json"),
    JSON.stringify({
      name: "@reef/web",
      scripts: { build: "node scripts/build.mjs" },
      dependencies: { "@reef/core": "workspace:*" },
    }),
  );
  await mkdir(join(root, "packages/core"));
  await writeFile(
    join(root, "packages/core/package.json"),
    JSON.stringify({ name: "@reef/core", scripts: { build: "tsdown" } }),
  );
  await writeFile(
    join(root, "packages/core/product.ts"),
    "export const value = 1;\n",
  );
  await writeFile(join(web, "product.ts"), "export const value = 1;\n");
  await writeFile(join(root, ".gitignore"), "node_modules/\n.next/\n.env*\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  await mkdir(join(web, ".next/static"), { recursive: true });
  await mkdir(join(web, ".next/standalone/packages/web/.next"), {
    recursive: true,
  });
  await writeFile(join(web, ".next/BUILD_ID"), "fixture-build");
  await writeFile(
    join(web, ".next/standalone/packages/web/.next/BUILD_ID"),
    "fixture-build",
  );
  await writeFile(join(web, ".next/standalone/packages/web/server.js"), "");
  await writeFile(
    join(web, "node_modules/.bin/playwright"),
    `#!${process.execPath}\nconsole.log('BROWSER_STARTED');\n`,
    { mode: 0o755 },
  );
  const dryRun = execFileSync(
    turboBin,
    ["run", "build", "--filter=@reef/web", "--dry=json"],
    { cwd: root, encoding: "utf8" },
  );
  const inputHash = JSON.parse(dryRun.slice(dryRun.indexOf("{"))).tasks.find(
    (task: { taskId: string }) => task.taskId === "@reef/web#build",
  ).hash;
  await writeFile(
    join(web, ".next/reef-build.json"),
    JSON.stringify({
      version: 1,
      inputHash,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      buildId: "fixture-build",
    }),
  );
  return { root, web };
}

function run(web: string, env: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    [join(web, "scripts/e2e-shards.mjs"), "--shards=1"],
    {
      cwd: web,
      encoding: "utf8",
      env: { ...process.env, REEF_E2E_SKIP_BUILD: "1", ...env },
    },
  );
}

it("rejects a stale production build before starting Playwright", async () => {
  const { web } = await fixture();
  await writeFile(join(web, "product.ts"), "export const value = 2;\n");
  const result = run(web);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("production build inputs changed");
  expect(result.stdout).not.toContain("BROWSER_STARTED");
});

it.each(["dependency", "root version", "ignored env file"])(
  "rejects changed %s inputs",
  async (input) => {
    const { root, web } = await fixture();
    if (input === "dependency") {
      await writeFile(
        join(root, "packages/core/product.ts"),
        "export const value = 2;\n",
      );
    } else if (input === "root version") {
      const manifestPath = join(root, "package.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      await writeFile(
        manifestPath,
        JSON.stringify({ ...manifest, version: "0.16.2" }),
      );
    } else {
      await writeFile(
        join(web, ".env.local"),
        "NEXT_PUBLIC_FIXTURE_VALUE=changed\n",
      );
    }
    const result = run(web);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("production build inputs changed");
    expect(result.stdout).not.toContain("BROWSER_STARTED");
  },
);

it("rejects changed public build environment inputs", async () => {
  const { web } = await fixture();
  const result = run(web, { NEXT_PUBLIC_FIXTURE_VALUE: "changed" });
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain("production build inputs changed");
  expect(result.stdout).not.toContain("BROWSER_STARTED");
});

it("removes old provenance when a fresh build fails", async () => {
  const { web } = await fixture();
  await mkdir(join(web, "node_modules/next/dist/bin"), { recursive: true });
  await writeFile(
    join(web, "node_modules/next/dist/bin/next.js"),
    "process.exit(7);\n",
  );
  const result = spawnSync(process.execPath, [join(web, "scripts/build.mjs")], {
    cwd: web,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(7);
  await expect(
    readFile(join(web, ".next/reef-build.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const reuse = run(web);
  expect(reuse.status).toBe(1);
  expect(reuse.stdout).not.toContain("BROWSER_STARTED");
});

it("allows reuse of the same production inputs", async () => {
  const { web } = await fixture();
  const result = run(web);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("BROWSER_STARTED");
});

it("rejects a build without provenance even inside a Turbo task", async () => {
  const { web } = await fixture();
  await rm(join(web, ".next/reef-build.json"));
  const result = run(web, { TURBO_HASH: "e2e-task-hash" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("production build provenance");
  expect(result.stdout).not.toContain("BROWSER_STARTED");
});

it("rejects an overwritten build with an old provenance record", async () => {
  const { web } = await fixture();
  await writeFile(join(web, ".next/BUILD_ID"), "other-build");
  const result = run(web);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("production build ID");
  expect(result.stdout).not.toContain("BROWSER_STARTED");
});

it("rejects reuse on a different Node runtime", async () => {
  const { web } = await fixture();
  const markerPath = join(web, ".next/reef-build.json");
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  await writeFile(
    markerPath,
    JSON.stringify({ ...marker, nodeVersion: "v22.19.0" }),
  );
  const result = run(web);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("production build runtime");
  expect(result.stdout).not.toContain("BROWSER_STARTED");
});
