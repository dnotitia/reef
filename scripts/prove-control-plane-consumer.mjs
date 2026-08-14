import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { parseDocument } from "yaml";

const root = process.cwd();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return result.stdout;
}

function rewriteCatalogDependencies(manifest, catalog) {
  for (const field of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const dependencies = manifest[field];
    if (!dependencies) continue;
    for (const [name, range] of Object.entries(dependencies)) {
      if (range === "catalog:") {
        const version = catalog[name];
        if (typeof version !== "string") {
          throw new Error(`default catalog entry is missing for ${name}`);
        }
        dependencies[name] = version;
      }
    }
  }
}

const packRoot = await mkdtemp(
  path.join(os.tmpdir(), "reef-control-plane-consumer-"),
);
try {
  const stageDir = path.join(packRoot, "stage");
  const tarballDir = path.join(packRoot, "tarballs");
  const consumerDir = path.join(packRoot, "consumer");
  await mkdir(tarballDir);
  await mkdir(consumerDir);
  await cp(path.join(root, "packages/core/dist"), path.join(stageDir, "dist"), {
    recursive: true,
  });
  const publicTypes = await readFile(
    path.join(stageDir, "dist/adapters/akb/controlPlane.d.ts"),
    "utf8",
  );
  if (
    /\bany\b|\b(app_key|created_at|updated_at|vault_id):/u.test(publicTypes)
  ) {
    throw new Error(
      "Core control-plane declarations leak an untyped or snake_case public field",
    );
  }

  const workspace = parseDocument(
    await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8"),
  ).toJS();
  const manifest = JSON.parse(
    await readFile(path.join(root, "packages/core/package.json"), "utf8"),
  );
  manifest.private = false;
  manifest.version = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  ).version;
  manifest.files = ["dist"];
  manifest.devDependencies = undefined;
  rewriteCatalogDependencies(manifest, workspace.catalog);
  await writeFile(
    path.join(stageDir, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const tarball = run(
    "pnpm",
    ["pack", "--pack-destination", tarballDir, "--reporter", "silent"],
    { cwd: stageDir },
  )
    .trim()
    .split("\n")
    .at(-1);
  if (!tarball) throw new Error("Core package pack did not return a tarball");

  const packageJson = {
    name: "reef-control-plane-consumer",
    private: true,
    type: "module",
    dependencies: {
      "@reef/core": `file:${path.relative(consumerDir, tarball)}`,
    },
  };
  await writeFile(
    path.join(consumerDir, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  await writeFile(
    path.join(consumerDir, "pnpm-workspace.yaml"),
    "overrides: {}\n",
  );
  run(
    "pnpm",
    [
      "install",
      "--ignore-scripts",
      "--no-frozen-lockfile",
      "--reporter",
      "silent",
    ],
    {
      cwd: consumerDir,
    },
  );

  await writeFile(
    path.join(consumerDir, "consumer.ts"),
    `import {
  ControlPlaneAppSchema,
  ControlPlaneError,
  ControlPlaneAuthorizeSchema,
  createControlPlaneAdminAdapter,
  createControlPlaneAppAdapter,
  type ControlPlaneAdminAdapter,
  type ControlPlaneAppAdapter,
  type ControlPlaneAuthorize,
  type ControlPlaneRequestPolicy,
  type ControlPlaneInstallation,
} from "@reef/core";

const adapter: ControlPlaneAdminAdapter = createControlPlaneAdminAdapter({
  baseUrl: "https://akb.example.test",
  adminToken: "deployment-admin-token",
});
const installation: Promise<ControlPlaneInstallation> = adapter.installations.get(
  "app-1",
  "vault-1",
);
const policy: ControlPlaneRequestPolicy = { timeoutMs: 1000, maxJsonResponseBytes: 1024 };
const appAdapter: ControlPlaneAppAdapter = createControlPlaneAppAdapter({
  baseUrl: "https://akb.example.test",
  appToken: "short-lived-app-token",
  requestPolicy: policy,
});
const authorization: Promise<ControlPlaneAuthorize> = appAdapter.authorize({
  vaultId: "vault-1",
  capability: "inventory:read",
});
const error: ControlPlaneError | undefined = undefined;
void ControlPlaneAppSchema;
void ControlPlaneAuthorizeSchema;
void installation;
void error;
void authorization;
`,
  );
  run(
    path.join(root, "packages/core/node_modules/.bin/tsc"),
    [
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "consumer.ts",
    ],
    { cwd: consumerDir },
  );
  console.log("Core control-plane public consumer typecheck passed");
} finally {
  await rm(packRoot, { recursive: true, force: true });
}
