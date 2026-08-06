import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { inspectToolchain } from "./check-toolchain-policy.mjs";

async function createFixture() {
  const root = await mkdtemp(
    path.join(process.cwd(), ".toolchain-policy-fixture-"),
  );
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "fixture-root",
        private: true,
        packageManager: "pnpm@11.10.0",
        engines: { node: ">=22.13.0" },
        devDependencies: { "root-tool": "^1.0.0" },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(root, "pnpm-workspace.yaml"),
    `packages:\n  - "packages/*"\n\ncatalog:\n  "@types/node": ^22.15.0\n  typescript: ^5.9.3\n  vitest: ^3.2.6\n  zod: ^3.25.76\n`,
  );
  await writeFile(path.join(root, ".node-version"), "22.23.2\n");
  await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await writeFile(
    path.join(root, ".github", "workflows", "ci.yml"),
    "jobs:\n  check:\n    steps:\n      - uses: actions/setup-node@v5\n        with:\n          node-version-file: .node-version\n",
  );
  await writeFile(
    path.join(root, "Dockerfile"),
    "FROM node:22.23.2-alpine\nRUN corepack enable\nRUN pnpm install --frozen-lockfile\n",
  );

  for (const [directory, manifest] of [
    [
      "one",
      {
        name: "@reef/one",
        private: true,
        dependencies: { zod: "catalog:" },
        devDependencies: {
          "@types/node": "catalog:",
          typescript: "catalog:",
          vitest: "catalog:",
        },
      },
    ],
    [
      "two",
      {
        name: "@reef/two",
        private: true,
        dependencies: { "@reef/one": "workspace:*", zod: "catalog:" },
        devDependencies: {
          "@types/node": "catalog:",
          typescript: "catalog:",
          vitest: "catalog:",
        },
      },
    ],
  ]) {
    const packageDir = path.join(root, "packages", directory);
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, "package.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  const fakePnpm = path.join(root, "fake-pnpm.mjs");
  await writeFile(
    fakePnpm,
    `#!/usr/bin/env node\nimport { readdirSync } from "node:fs";\nimport path from "node:path";\nconst root = process.cwd();\nconst paths = readdirSync(path.join(root, "packages"), { withFileTypes: true })\n  .filter((entry) => entry.isDirectory())\n  .map((entry) => ({ path: path.join(root, "packages", entry.name) }));\nprocess.stdout.write(JSON.stringify(paths));\n`,
  );
  await chmod(fakePnpm, 0o755);

  return { root, pnpmCommand: fakePnpm };
}

async function withFixture(mutator, assertion) {
  const fixture = await createFixture();
  try {
    await mutator?.(fixture.root);
    await assertion(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function readManifest(root, packageName) {
  return JSON.parse(
    await readFile(
      path.join(root, "packages", packageName, "package.json"),
      "utf8",
    ),
  );
}

async function writeManifest(root, packageName, manifest) {
  await writeFile(
    path.join(root, "packages", packageName, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

test("accepts the canonical catalog and runtime baseline", async () => {
  await withFixture(null, async ({ root, pnpmCommand }) => {
    const result = await inspectToolchain({ root, pnpmCommand });
    assert.deepEqual(result.violations, []);
  });
});

test("rejects a direct version bypass for a catalog dependency", async () => {
  await withFixture(
    async (root) => {
      const manifest = await readManifest(root, "one");
      manifest.dependencies.zod = "^3.25.76";
      await writeManifest(root, "one", manifest);
    },
    async ({ root, pnpmCommand }) => {
      const result = await inspectToolchain({ root, pnpmCommand });
      assert.ok(
        result.violations.some(({ code }) => code === "catalog-bypass"),
      );
    },
  );
});

test("rejects a direct catalog version even when the dependency is used once", async () => {
  await withFixture(
    async (root) => {
      const one = await readManifest(root, "one");
      one.dependencies.zod = "^3.25.76";
      await writeManifest(root, "one", one);

      const two = await readManifest(root, "two");
      two.dependencies = { "@reef/one": "workspace:*" };
      await writeManifest(root, "two", two);
    },
    async ({ root, pnpmCommand }) => {
      const result = await inspectToolchain({ root, pnpmCommand });
      assert.ok(
        result.violations.some(({ code }) => code === "catalog-bypass"),
      );
    },
  );
});

test("rejects a root-owned tool duplicated in a workspace", async () => {
  await withFixture(
    async (root) => {
      const manifest = await readManifest(root, "two");
      manifest.devDependencies["root-tool"] = "^1.0.0";
      await writeManifest(root, "two", manifest);
    },
    async ({ root, pnpmCommand }) => {
      const result = await inspectToolchain({ root, pnpmCommand });
      assert.ok(
        result.violations.some(({ code }) => code === "root-tool-duplicate"),
      );
    },
  );
});

test("rejects an internal workspace dependency without workspace protocol", async () => {
  await withFixture(
    async (root) => {
      const manifest = await readManifest(root, "two");
      manifest.dependencies["@reef/one"] = "^1.0.0";
      await writeManifest(root, "two", manifest);
    },
    async ({ root, pnpmCommand }) => {
      const result = await inspectToolchain({ root, pnpmCommand });
      assert.ok(
        result.violations.some(({ code }) => code === "workspace-protocol"),
      );
    },
  );
});

test("rejects Node and pnpm runtime drift", async () => {
  await withFixture(
    async (root) => {
      await writeFile(path.join(root, ".node-version"), "20.19.0\n");
      await writeFile(
        path.join(root, "Dockerfile"),
        "FROM node:20-alpine\nRUN corepack enable && corepack prepare pnpm@10.0.0 --activate\n",
      );
    },
    async ({ root, pnpmCommand }) => {
      const result = await inspectToolchain({ root, pnpmCommand });
      assert.ok(result.violations.some(({ code }) => code === "node-version"));
      assert.ok(result.violations.some(({ code }) => code === "docker-node"));
      assert.ok(result.violations.some(({ code }) => code === "pnpm-pin"));
    },
  );
});

test("rejects a Docker Node patch that drifts from the exact runtime pin", async () => {
  await withFixture(
    async (root) => {
      await writeFile(
        path.join(root, "Dockerfile"),
        "FROM node:22.13.0-alpine\nRUN corepack enable\n",
      );
    },
    async ({ root, pnpmCommand }) => {
      const result = await inspectToolchain({ root, pnpmCommand });
      assert.ok(
        result.violations.some(({ code }) => code === "docker-node-drift"),
      );
    },
  );
});

test("rejects unused and named catalog entries", async () => {
  await withFixture(
    async (root) => {
      const manifest = await readManifest(root, "one");
      manifest.dependencies.zod = "catalog:legacy";
      await writeManifest(root, "one", manifest);

      await writeFile(
        path.join(root, "pnpm-workspace.yaml"),
        `packages:\n  - "packages/*"\n\ncatalog:\n  "@types/node": ^22.15.0\n  typescript: ^5.9.3\n  vitest: ^3.2.6\n  zod: ^3.25.76\n  unused: ^1.0.0\n\ncatalogs:\n  legacy:\n    old: ^1.0.0\n`,
      );
    },
    async ({ root, pnpmCommand }) => {
      const result = await inspectToolchain({ root, pnpmCommand });
      assert.ok(
        result.violations.some(({ code }) => code === "catalog-unused"),
      );
      assert.ok(result.violations.some(({ code }) => code === "named-catalog"));
      assert.ok(
        result.violations.some(({ code }) => code === "named-catalog-use"),
      );
    },
  );
});

test("rejects TypeScript and Node type catalog drift", async () => {
  await withFixture(
    async (root) => {
      await writeFile(
        path.join(root, "pnpm-workspace.yaml"),
        `packages:\n  - "packages/*"\n\ncatalog:\n  "@types/node": ^20.19.39\n  typescript: ^5.8.0\n  vitest: ^3.2.6\n  zod: ^3.25.76\n`,
      );
    },
    async ({ root, pnpmCommand }) => {
      const result = await inspectToolchain({ root, pnpmCommand });
      assert.ok(
        result.violations.some(({ code }) => code === "node-types-version"),
      );
      assert.ok(
        result.violations.some(({ code }) => code === "typescript-version"),
      );
    },
  );
});
