#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectTests, scheduleTests } from "./e2e-scheduling.mts";
import { assertCurrentProductionBuild } from "./production-build.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_WEB_URL = "http://localhost:7353";
const DEFAULT_MOCK_URL = "http://127.0.0.1:7354";
const PORT_STRIDE = 10;

const { shardCount, selectedShard, passthroughArgs } = parseArgs(
  process.argv.slice(2),
);
const baseWebUrl = new URL(process.env.REEF_WEB_URL ?? DEFAULT_WEB_URL);
const baseMockUrl = new URL(process.env.REEF_E2E_MOCK_URL ?? DEFAULT_MOCK_URL);
const baseWebPort = Number(baseWebUrl.port || 80);
const baseMockPort = Number(baseMockUrl.port || 80);
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const playwrightBin = resolve(
  PACKAGE_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "playwright.cmd" : "playwright",
);

const start = performance.now();
let interrupted = false;
const children = new Set();

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

if (!Number.isInteger(shardCount) || shardCount < 1) {
  process.stderr.write("[e2e:shards] --shards must be a positive integer.\n");
  process.exit(1);
}

try {
  const shards = selectedShard
    ? [selectedShard]
    : Array.from({ length: shardCount }, (_, index) => ({
        index: index + 1,
        total: shardCount,
      }));

  await mkdir(resolve(PACKAGE_ROOT, "test-results"), { recursive: true });
  await Promise.all(
    shards.map(({ index }) =>
      rm(resolve(PACKAGE_ROOT, "test-results", `shard-${index}`), {
        force: true,
        recursive: true,
      }),
    ),
  );

  if (process.env.REEF_E2E_SKIP_BUILD !== "1" && !process.env.TURBO_HASH) {
    await runOneShot("build", pnpmBin, [
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=@reef/web",
    ]);
  } else {
    process.stdout.write("[e2e:shards] skipping Next.js build\n");
  }
  await assertCurrentProductionBuild();
  await prepareStandaloneAssets();

  process.stdout.write(
    selectedShard
      ? `[e2e:shards] running Playwright shard ${selectedShard.index}/${selectedShard.total}\n`
      : `[e2e:shards] running ${shardCount} Playwright shards in parallel\n`,
  );

  const collectionPath = resolve(
    PACKAGE_ROOT,
    "test-results",
    "collection.json",
  );
  await runOneShot(
    "collect",
    playwrightBin,
    ["test", "--list", ...passthroughArgs, "--reporter=json"],
    { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: collectionPath },
  );
  const inventory = collectTests(
    JSON.parse(await readFile(collectionPath, "utf8")),
  );
  const profile = JSON.parse(
    await readFile(
      resolve(PACKAGE_ROOT, "scripts", "e2e-duration-profile.json"),
      "utf8",
    ),
  );
  const plans = scheduleTests(inventory, profile, shards[0].total);
  for (const { index } of shards) {
    const plan = plans[index - 1];
    await mkdir(resolve(PACKAGE_ROOT, "test-results", `shard-${index}`), {
      recursive: true,
    });
    for (const project of ["chromium", "visual-matrix", "sso"]) {
      const selectors = plan.tests
        .filter((test) => test.project === project)
        .map((test) => test.selector);
      await writeFile(
        resolve(
          PACKAGE_ROOT,
          "test-results",
          `shard-${index}`,
          `${project}-tests.txt`,
        ),
        `${selectors.join("\n")}\n`,
      );
    }
    process.stdout.write(
      `[e2e:${index}/${shards[0].total}] planned ${plan.tests.length} tests / ${(plan.estimatedDurationMs / 1000).toFixed(1)}s\n`,
    );
  }
  const executionStart = performance.now();
  const buildAndPreparationMs = executionStart - start;
  const results = await Promise.all(
    shards.map(({ index, total }) => {
      const portOffset = (index - 1) * PORT_STRIDE;
      const webUrl = withPort(baseWebUrl, baseWebPort + portOffset);
      const mockUrl = withPort(baseMockUrl, baseMockPort + portOffset);
      return runShard(index, total, webUrl, mockUrl, plans[index - 1]);
    }),
  );

  const durationMs = performance.now() - start;
  await writeFile(
    resolve(PACKAGE_ROOT, "test-results", "e2e-timings.json"),
    `${JSON.stringify({ version: 1, buildAndPreparationMs, durationMs, shards: results }, null, 2)}\n`,
  );
  const elapsed = (durationMs / 1000).toFixed(1);
  const failed = results.filter((result) => result.code !== 0);
  process.stdout.write(`[e2e:shards] finished in ${elapsed}s\n`);

  if (failed.length > 0) {
    for (const result of failed) {
      process.stderr.write(
        `[e2e:shards] shard ${result.shard}/${result.total} failed with exit code ${result.code}\n`,
      );
    }
    process.exit(1);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[e2e:shards] ${message}\n`);
  shutdown(1);
}

function parseArgs(args, env = process.env) {
  let shardCount = Number(env.REEF_E2E_SHARDS ?? 3);
  let shardCountExplicit = env.REEF_E2E_SHARDS !== undefined;
  let selectedShard = null;
  const passthroughArgs = [];
  let parsingScriptOptions = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (parsingScriptOptions && arg === "--") {
      const forwardedShard = args[index + 1];
      if (forwardedShard?.startsWith("--shard=")) {
        if (selectedShard) {
          throw new Error("--shard may be specified only once");
        }
        selectedShard = parseShardSelector(
          forwardedShard.slice("--shard=".length),
        );
        index += 1;
      }
      parsingScriptOptions = false;
      continue;
    }

    if (parsingScriptOptions && arg === "--shards") {
      shardCount = Number(args[index + 1]);
      shardCountExplicit = true;
      index += 1;
      continue;
    }

    if (parsingScriptOptions && arg.startsWith("--shards=")) {
      shardCount = Number(arg.slice("--shards=".length));
      shardCountExplicit = true;
      continue;
    }

    if (parsingScriptOptions && arg.startsWith("--shard=")) {
      if (selectedShard) {
        throw new Error("--shard may be specified only once");
      }
      selectedShard = parseShardSelector(arg.slice("--shard=".length));
      continue;
    }

    passthroughArgs.push(arg);
  }

  if (selectedShard && shardCountExplicit) {
    throw new Error(
      "--shard cannot be combined with --shards or REEF_E2E_SHARDS",
    );
  }
  if (
    selectedShard &&
    passthroughArgs.some(
      (arg) => arg === "--shard" || arg.startsWith("--shard="),
    )
  ) {
    throw new Error("--shard must be supplied only as an e2e-shards option");
  }

  return { shardCount, selectedShard, passthroughArgs };
}

function parseShardSelector(value) {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/u.exec(value);
  if (!match) {
    throw new Error("--shard must use positive integers in the form i/n");
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total)) {
    throw new Error("--shard values must be safe positive integers");
  }
  if (index > total) {
    throw new Error("--shard index must be less than or equal to its total");
  }
  return { index, total };
}

function withPort(url, port) {
  const next = new URL(url.toString());
  next.port = String(port);
  return next.toString().replace(/\/$/, "");
}

async function runShard(shard, total, webUrl, mockUrl, plan) {
  const shardStart = performance.now();
  const projects = [];
  let code = 0;
  // One fixture server per shard: run project phases sequentially.
  for (const project of ["chromium", "visual-matrix", "sso"]) {
    if (interrupted) break;
    if (!plan.tests.some((test) => test.project === project)) continue;
    const result = await runProjectShard(
      shard,
      total,
      webUrl,
      mockUrl,
      project,
    );
    projects.push(result);
    code ||= result.code;
  }
  const durationMs = performance.now() - shardStart;
  process.stdout.write(
    `[e2e:${shard}/${total}] shard finished in ${(durationMs / 1000).toFixed(1)}s\n`,
  );
  return {
    shard,
    total,
    code: interrupted ? 1 : code,
    durationMs,
    estimatedDurationMs: plan.estimatedDurationMs,
    testCount: plan.tests.length,
    projects,
  };
}

function runProjectShard(shard, total, webUrl, mockUrl, project) {
  const projectStart = performance.now();
  const prefix = `[e2e:${shard}/${total}]`;
  const args = [
    "test",
    `--project=${project}`,
    `--test-list=test-results/shard-${shard}/${project}-tests.txt`,
    `--output=test-results/shard-${shard}/${project}`,
    `--reporter=${process.env.CI ? "github" : "list"},json`,
    ...passthroughArgs,
  ];

  process.stdout.write(
    `${prefix} REEF_WEB_URL=${webUrl} REEF_E2E_MOCK_URL=${mockUrl}\n`,
  );

  const child = spawn(playwrightBin, args, {
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
      PWTEST_CACHE_DIR: resolve(
        PACKAGE_ROOT,
        "test-results",
        `transform-cache-${shard}`,
      ),
      PLAYWRIGHT_JSON_OUTPUT_FILE: resolve(
        PACKAGE_ROOT,
        "test-results",
        `shard-${shard}`,
        project,
        "report.json",
      ),
      REEF_E2E_AUTH_MODE: project === "sso" ? "sso" : "local",
      REEF_WEB_URL: webUrl,
      REEF_E2E_MOCK_URL: mockUrl,
      REEF_E2E_WEB_COMMAND:
        "PORT={port} node .next/standalone/packages/web/server.js",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);

  pipeWithPrefix(child.stdout, process.stdout, prefix);
  pipeWithPrefix(child.stderr, process.stderr, prefix);

  return new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      children.delete(child);
      const durationMs = performance.now() - projectStart;
      const exitCode = signal && interrupted ? 1 : (code ?? (signal ? 1 : 0));
      process.stdout.write(
        `${prefix} ${project} finished in ${(durationMs / 1000).toFixed(1)}s (exit ${exitCode})\n`,
      );
      resolve({ project, code: exitCode, durationMs });
    });
  });
}

function runOneShot(name, command, args, env = process.env) {
  process.stdout.write(`[e2e:shards] ${name}: ${command} ${args.join(" ")}\n`);
  const child = spawn(command, args, {
    cwd: PACKAGE_ROOT,
    env,
    stdio: name === "collect" ? ["ignore", "ignore", "inherit"] : "inherit",
  });
  children.add(child);

  return new Promise((resolve, reject) => {
    child.on("exit", (code, signal) => {
      children.delete(child);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${name} failed with ${signal ? `signal ${signal}` : `exit code ${code ?? 1}`}`,
        ),
      );
    });
  });
}

async function prepareStandaloneAssets() {
  const standaloneWebRoot = resolve(
    PACKAGE_ROOT,
    ".next",
    "standalone",
    "packages",
    "web",
  );
  const standaloneStatic = resolve(standaloneWebRoot, ".next", "static");
  await rm(standaloneStatic, { force: true, recursive: true });
  await cp(resolve(PACKAGE_ROOT, ".next", "static"), standaloneStatic, {
    recursive: true,
  });

  const standalonePublic = resolve(standaloneWebRoot, "public");
  await rm(standalonePublic, { force: true, recursive: true });
  try {
    await cp(resolve(PACKAGE_ROOT, "public"), standalonePublic, {
      recursive: true,
    });
  } catch (err) {
    if (!(err instanceof Error && "code" in err && err.code === "ENOENT")) {
      throw err;
    }
  }
}

function pipeWithPrefix(readable, writable, prefix) {
  let pending = "";
  readable.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      writable.write(line.length > 0 ? `${prefix} ${line}\n` : "\n");
    }
  });
  readable.on("end", () => {
    if (pending.length > 0) {
      writable.write(`${prefix} ${pending}\n`);
      pending = "";
    }
  });
}

function shutdown(code) {
  interrupted = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1000).unref();
}
