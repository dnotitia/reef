import { spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = process.cwd();

function run(command, args, { cwd = root, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
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

async function copyGitSnapshot(destination) {
  const files = run("git", [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ])
    .split("\0")
    .filter(Boolean);

  for (const relativePath of files) {
    const sourcePath = path.join(root, relativePath);
    const sourceStats = await lstat(sourcePath).catch(() => null);
    if (!sourceStats) continue;
    const destinationPath = path.join(destination, relativePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    if (sourceStats.isSymbolicLink()) {
      await symlink(await readlink(sourcePath), destinationPath);
    } else {
      await cp(sourcePath, destinationPath);
    }
  }

  run("git", ["init", "--quiet"], { cwd: destination });
  run("git", ["config", "user.name", "Reef package contract"], {
    cwd: destination,
  });
  run("git", ["config", "user.email", "package-contract@reef.invalid"], {
    cwd: destination,
  });
  run("git", ["add", "--all"], { cwd: destination });
  run(
    "git",
    ["-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "snapshot"],
    { cwd: destination },
  );
  return run("git", ["rev-parse", "HEAD"], { cwd: destination }).trim();
}

async function assertInstalledCore(consumerDir) {
  const packageDir = path.join(consumerDir, "node_modules", "@reef", "core");
  const manifest = JSON.parse(
    await readFile(path.join(packageDir, "package.json"), "utf8"),
  );
  const dependencySpecs = [
    ...Object.values(manifest.dependencies ?? {}),
    ...Object.values(manifest.devDependencies ?? {}),
  ];
  if (dependencySpecs.some((spec) => String(spec).startsWith("catalog:"))) {
    throw new Error("installed @reef/core manifest still contains catalog:");
  }
  if (!(await stat(path.join(packageDir, "dist", "index.js"))).isFile()) {
    throw new Error(
      "installed @reef/core is missing its prepared dist/index.js",
    );
  }
  run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'const { createAkbAdapter } = await import("@reef/core"); if (typeof createAkbAdapter !== "function") throw new Error("createAkbAdapter is not a function");',
    ],
    { cwd: consumerDir },
  );
}

async function runSmoke() {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "reef-core-git-consumer-"),
  );
  try {
    const sourceDir = path.join(temporaryRoot, "source");
    const consumerDir = path.join(temporaryRoot, "consumer");
    const storeDir = path.join(temporaryRoot, "pnpm-store");
    await mkdir(sourceDir);
    await mkdir(consumerDir);
    const commit = await copyGitSnapshot(sourceDir);
    const sourceUrl = pathToFileURL(sourceDir).href;
    const dependency = `git+${sourceUrl}#${commit}&path:packages/core`;

    await writeFile(
      path.join(consumerDir, "package.json"),
      `${JSON.stringify(
        {
          name: "reef-core-git-consumer",
          private: true,
          type: "module",
          dependencies: { "@reef/core": dependency },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      path.join(consumerDir, "pnpm-workspace.yaml"),
      `allowBuilds:\n  ${JSON.stringify(`@reef/core@${dependency}`)}: true\n`,
    );

    const installArgs = [
      "install",
      "--store-dir",
      storeDir,
      "--reporter",
      "append-only",
    ];
    run("pnpm", [...installArgs, "--no-frozen-lockfile"], {
      cwd: consumerDir,
    });
    await assertInstalledCore(consumerDir);

    const lockfile = await readFile(
      path.join(consumerDir, "pnpm-lock.yaml"),
      "utf8",
    );
    if (
      !lockfile.includes(commit) ||
      !lockfile.includes("path:packages/core")
    ) {
      throw new Error(
        "consumer lockfile does not pin the Git commit and core subdirectory",
      );
    }

    await rm(path.join(consumerDir, "node_modules"), {
      recursive: true,
      force: true,
    });
    run("pnpm", [...installArgs, "--frozen-lockfile"], { cwd: consumerDir });
    await assertInstalledCore(consumerDir);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  await runSmoke();
  console.log(
    "core Git consumer smoke passed: local commit, subdirectory prepare, frozen lockfile, and createAkbAdapter ESM import",
  );
} catch (error) {
  console.error(`core Git consumer smoke failed: ${error.message}`);
  process.exitCode = 1;
}
