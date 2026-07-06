#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_WEB_URL = "http://localhost:7353";
const DEFAULT_MOCK_URL = "http://127.0.0.1:7354";
const PORT_STRIDE = 10;

const { shardCount, passthroughArgs } = parseArgs(process.argv.slice(2));
const baseWebUrl = new URL(process.env.REEF_WEB_URL ?? DEFAULT_WEB_URL);
const baseMockUrl = new URL(process.env.REEF_E2E_MOCK_URL ?? DEFAULT_MOCK_URL);
const baseWebPort = Number(baseWebUrl.port || 80);
const baseMockPort = Number(baseMockUrl.port || 80);
const nextBin = resolve(
  PACKAGE_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "next.cmd" : "next",
);
const playwrightBin = resolve(
  PACKAGE_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "playwright.cmd" : "playwright",
);

const start = Date.now();
let interrupted = false;
const children = new Set();

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

if (!Number.isInteger(shardCount) || shardCount < 1) {
  process.stderr.write("[e2e:shards] --shards must be a positive integer.\n");
  process.exit(1);
}

try {
  await Promise.all(
    Array.from({ length: shardCount }, (_, index) =>
      rm(resolve(PACKAGE_ROOT, "test-results", `shard-${index + 1}`), {
        force: true,
        recursive: true,
      }),
    ),
  );

  if (process.env.REEF_E2E_SKIP_BUILD !== "1") {
    await runOneShot("build", nextBin, ["build", "--webpack"]);
  } else {
    process.stdout.write("[e2e:shards] skipping Next.js build\n");
  }
  await prepareStandaloneAssets();

  process.stdout.write(
    `[e2e:shards] running ${shardCount} Playwright shards in parallel\n`,
  );

  const results = await Promise.all(
    Array.from({ length: shardCount }, (_, index) => {
      const shard = index + 1;
      const webUrl = withPort(baseWebUrl, baseWebPort + index * PORT_STRIDE);
      const mockUrl = withPort(baseMockUrl, baseMockPort + index * PORT_STRIDE);
      return runShard(shard, shardCount, webUrl, mockUrl);
    }),
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const failed = results.filter((result) => result.code !== 0);
  process.stdout.write(`[e2e:shards] finished in ${elapsed}s\n`);

  if (failed.length > 0) {
    for (const result of failed) {
      process.stderr.write(
        `[e2e:shards] shard ${result.shard}/${shardCount} failed with exit code ${result.code}\n`,
      );
    }
    process.exit(1);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[e2e:shards] ${message}\n`);
  shutdown(1);
}

function parseArgs(args) {
  let shardCount = Number(process.env.REEF_E2E_SHARDS ?? 3);
  const passthroughArgs = [];
  let parsingScriptOptions = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (parsingScriptOptions && arg === "--") {
      parsingScriptOptions = false;
      continue;
    }

    if (parsingScriptOptions && arg === "--shards") {
      shardCount = Number(args[index + 1]);
      index += 1;
      continue;
    }

    if (parsingScriptOptions && arg.startsWith("--shards=")) {
      shardCount = Number(arg.slice("--shards=".length));
      continue;
    }

    passthroughArgs.push(arg);
  }

  return { shardCount, passthroughArgs };
}

function withPort(url, port) {
  const next = new URL(url.toString());
  next.port = String(port);
  return next.toString().replace(/\/$/, "");
}

function runShard(shard, total, webUrl, mockUrl) {
  const prefix = `[e2e:${shard}/${total}]`;
  const args = [
    "test",
    `--shard=${shard}/${total}`,
    `--output=test-results/shard-${shard}`,
    ...passthroughArgs,
  ];

  process.stdout.write(
    `${prefix} REEF_WEB_URL=${webUrl} REEF_E2E_MOCK_URL=${mockUrl}\n`,
  );

  const child = spawn(playwrightBin, args, {
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
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
      if (signal && interrupted) {
        resolve({ shard, code: 1 });
        return;
      }
      resolve({ shard, code: code ?? (signal ? 1 : 0) });
    });
  });
}

function runOneShot(name, command, args) {
  process.stdout.write(`[e2e:shards] ${name}: ${command} ${args.join(" ")}\n`);
  const child = spawn(command, args, {
    cwd: PACKAGE_ROOT,
    env: process.env,
    stdio: "inherit",
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
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1000).unref();
}
