#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const WEB_URL = process.env.REEF_WEB_URL ?? "http://localhost:7353";
const MOCK_URL = process.env.REEF_E2E_MOCK_URL ?? "http://127.0.0.1:7354";
const WEB_PORT = new URL(WEB_URL).port || "7353";
const MOCK = new URL(MOCK_URL);
const MOCK_PORT = MOCK.port || "7354";
const MOCK_HOST = MOCK.hostname;
const SCENARIO =
  process.argv.slice(2).find((arg) => arg !== "--") ??
  process.env.REEF_E2E_SCENARIO ??
  "configured";
const SCENARIOS = new Set([
  "empty",
  "configured",
  "raw_only",
  "activity_suggestions",
  "skill_outdated",
]);

const children = new Set();
let shuttingDown = false;

function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function spawnChild(name, command, args, env = {}) {
  process.stdout.write(
    `[dev:e2e] starting ${name}: ${command} ${args.join(" ")}\n`,
  );
  const child = spawn(command, args, {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `exit code ${code ?? 0}`;
    process.stderr.write(`[dev:e2e] ${name} stopped with ${reason}\n`);
    shutdown(code ?? 1);
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
  if (children.size === 0) process.exit(code);
  setTimeout(() => process.exit(code), 1000).unref();
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOk(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    await delay(250);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function resetScenario() {
  const response = await fetch(`${MOCK_URL}/__e2e/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario: SCENARIO }),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to reset fixture (${response.status}): ${await response.text()}`,
    );
  }
  const body = await response.json();
  process.stdout.write(`[dev:e2e] fixture scenario: ${body.scenario}\n`);
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

try {
  if (!SCENARIOS.has(SCENARIO)) {
    throw new Error(
      [
        `Unknown E2E fixture scenario: ${SCENARIO}`,
        `Expected one of: ${[...SCENARIOS].join(", ")}`,
      ].join("\n"),
    );
  }

  spawnChild("fixture server", "node", ["tests/e2e/harness/mock-server.mjs"], {
    REEF_E2E_MOCK_HOST: MOCK_HOST,
    REEF_E2E_MOCK_PORT: MOCK_PORT,
  });
  await waitForOk(`${MOCK_URL}/__e2e/health`, 30_000);
  await resetScenario();

  spawnChild(
    "reef-web",
    pnpmCommand(),
    ["exec", "next", "dev", "--turbopack", "-p", WEB_PORT],
    {
      AKB_BACKEND_URL: process.env.AKB_BACKEND_URL ?? `${MOCK_URL}/akb`,
      OPENROUTER_API_KEY:
        process.env.OPENROUTER_API_KEY ?? "e2e-openrouter-key",
      OPENROUTER_BASE_URL:
        process.env.OPENROUTER_BASE_URL ?? `${MOCK_URL}/openrouter/v1`,
      REEF_LLM_MODEL: process.env.REEF_LLM_MODEL ?? "e2e/mock-model",
      REEF_GITHUB_API_BASE_URL:
        process.env.REEF_GITHUB_API_BASE_URL ?? `${MOCK_URL}/github`,
    },
  );

  process.stdout.write(
    `${[
      `[dev:e2e] open ${WEB_URL} in a real web browser`,
      "[dev:e2e] fixture login: alice / password",
      `[dev:e2e] reset fixture: pnpm --filter web run reset:e2e -- ${SCENARIO}`,
    ].join("\n")}\n`,
  );
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[dev:e2e] ${message}\n`);
  shutdown(1);
}
