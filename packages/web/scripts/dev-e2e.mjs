#!/usr/bin/env node

import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { chmod, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_PATH = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(MODULE_PATH), "..");
const DEFAULT_WEB_URL = "http://localhost:7353";
const DEFAULT_MOCK_URL = "http://127.0.0.1:7354";
const DEFAULT_SCENARIO = "configured";
const SAFE_SCENARIO = /^[A-Za-z][A-Za-z0-9_-]*$/u;
const E2E_GITHUB_APP_PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
})
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();

const children = new Set();
let shuttingDown = false;
let finishingShutdown = false;
let shutdownCode = 0;
let shutdownTimer;
let removeReadyFileOnShutdown = false;
let readyFilePath = null;

function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

export function validateScenario(value) {
  if (typeof value !== "string" || !SAFE_SCENARIO.test(value)) {
    throw new Error(
      `Invalid E2E fixture scenario: ${String(value)}. Use letters, numbers, underscores, and hyphens.`,
    );
  }
  return value;
}

function parseOrigin(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`${name} must be an absolute HTTP(S) origin`, {
      cause: error,
    });
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(`${name} must be a credential-free HTTP(S) origin`);
  }
  return url.origin;
}

export function parseOptions(argv = process.argv.slice(2), env = process.env) {
  let scenarioArg;
  let readyFileArg;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--ready-file" || arg === "--ready_file") {
      readyFileArg = argv[index + 1];
      if (!readyFileArg || readyFileArg === "--") {
        throw new Error(`${arg} requires a file path`);
      }
      index += 1;
      continue;
    }
    if (arg === "--scenario") {
      scenarioArg = argv[index + 1];
      if (!scenarioArg || scenarioArg === "--") {
        throw new Error("--scenario requires a value");
      }
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (scenarioArg !== undefined) {
      throw new Error(`Unexpected E2E fixture argument: ${arg}`);
    }
    scenarioArg = arg;
  }

  const scenario = validateScenario(
    scenarioArg ?? env.REEF_E2E_SCENARIO ?? DEFAULT_SCENARIO,
  );
  const webOrigin = parseOrigin(
    env.REEF_WEB_URL ?? DEFAULT_WEB_URL,
    "REEF_WEB_URL",
  );
  const fixtureOrigin = parseOrigin(
    env.REEF_E2E_MOCK_URL ?? DEFAULT_MOCK_URL,
    "REEF_E2E_MOCK_URL",
  );
  const readyFile = readyFileArg ?? env.REEF_E2E_READY_FILE ?? null;
  if (readyFile === "") {
    throw new Error("REEF_E2E_READY_FILE must be a non-empty path");
  }

  const webUrl = new URL(webOrigin);
  const fixtureUrl = new URL(fixtureOrigin);
  return {
    scenario,
    readyFile,
    webOrigin,
    webPort: webUrl.port || "7353",
    fixtureOrigin,
    fixtureHost: fixtureUrl.hostname,
    fixturePort: fixtureUrl.port || "7354",
  };
}

export function buildReadyPayload({ webOrigin, fixtureOrigin, scenario }) {
  const validatedScenario = validateScenario(scenario);
  return {
    schema_version: 2,
    status: "ready",
    scenario: validatedScenario,
    services: {
      web: {
        origin: webOrigin,
        health: { method: "GET", url: webOrigin },
      },
      fixture: {
        origin: fixtureOrigin,
        health: {
          method: "GET",
          url: `${fixtureOrigin}/__e2e/health`,
        },
        reset: {
          method: "POST",
          url: `${fixtureOrigin}/__e2e/reset`,
          content_type: "application/json",
          body: { scenario: validatedScenario },
        },
        discovery: {
          method: "GET",
          url: `${fixtureOrigin}/__e2e/runtime`,
        },
      },
    },
  };
}

export function validateResetBody(body, requestedScenario) {
  validateScenario(requestedScenario);
  if (body?.ok !== true || body.scenario !== requestedScenario) {
    throw new Error(
      `Fixture rejected scenario "${requestedScenario}" (returned ${String(body?.scenario ?? "none")})`,
    );
  }
  return body;
}

export async function writeReadyFile(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(filePath, 0o600);
}

async function removeReadyFile(filePath) {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function killChild(child, signal) {
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function finishShutdown() {
  if (finishingShutdown) return;
  finishingShutdown = true;
  if (shutdownTimer) clearTimeout(shutdownTimer);
  if (removeReadyFileOnShutdown) {
    try {
      await removeReadyFile(readyFilePath);
    } catch (error) {
      process.stderr.write(
        `[dev:e2e] failed to remove ready file: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      shutdownCode = shutdownCode || 1;
    }
  }
  process.exit(shutdownCode);
}

function shutdown(code = 0) {
  if (code !== 0) shutdownCode = code;
  removeReadyFileOnShutdown = true;
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killChild(child, "SIGTERM");
  if (children.size === 0) {
    void finishShutdown();
    return;
  }
  shutdownTimer = setTimeout(() => {
    for (const child of children) killChild(child, "SIGKILL");
    void finishShutdown();
  }, 1_500);
  shutdownTimer.unref();
}

function spawnChild(name, command, args, env = {}) {
  process.stdout.write(
    `[dev:e2e] starting ${name}: ${command} ${args.join(" ")}\n`,
  );
  const child = spawn(command, args, {
    cwd: PACKAGE_ROOT,
    detached: process.platform !== "win32",
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) {
      if (children.size === 0) void finishShutdown();
      return;
    }
    const reason = signal ? `signal ${signal}` : `exit code ${code ?? 0}`;
    process.stderr.write(`[dev:e2e] ${name} stopped with ${reason}\n`);
    shutdown(code ?? 1);
  });
  return child;
}

async function delay(ms) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export async function waitForOk(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (shuttingDown) throw new Error(`Stopped waiting for ${url}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

export async function resetScenario(fixtureOrigin, scenario) {
  const resetUrl = `${fixtureOrigin}/__e2e/reset`;
  const response = await fetch(resetUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario }),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to reset fixture (${response.status}): ${await response.text()}`,
    );
  }
  const body = await response.json();
  return validateResetBody(body, scenario);
}

export async function startRuntime(options) {
  readyFilePath = options.readyFile;
  await removeReadyFile(readyFilePath);

  spawnChild("fixture server", "node", ["tests/e2e/harness/mock-server.mjs"], {
    REEF_E2E_MOCK_HOST: options.fixtureHost,
    REEF_E2E_MOCK_PORT: options.fixturePort,
  });
  await waitForOk(`${options.fixtureOrigin}/__e2e/health`, 30_000);
  const resetBody = await resetScenario(
    options.fixtureOrigin,
    options.scenario,
  );

  spawnChild(
    "reef-web",
    pnpmCommand(),
    ["exec", "next", "dev", "-p", options.webPort],
    {
      // The hermetic runtime owns its auth backend. Do not let an ambient
      // operator/deployment backend replace the fixture that discovery
      // advertises for browser login.
      AKB_BACKEND_URL: `${options.fixtureOrigin}/akb`,
      // Server-read akb web base (REEF-368) so linked-document backlinks render
      // when browsing the hermetic runtime locally.
      AKB_WEB_URL: process.env.AKB_WEB_URL ?? "https://akb.e2e.test",
      // Pin this hermetic runtime to the canonical names even when the parent
      // shell still exports the supported OpenRouter compatibility aliases.
      OPENROUTER_API_KEY: "",
      OPENROUTER_BASE_URL: "",
      REEF_LLM_API_KEY: process.env.REEF_LLM_API_KEY ?? "e2e-llm-endpoint-key",
      REEF_LLM_BASE_URL:
        process.env.REEF_LLM_BASE_URL ??
        `${options.fixtureOrigin}/openrouter/v1`,
      REEF_LLM_MODEL: process.env.REEF_LLM_MODEL ?? "e2e/mock-model",
      REEF_GITHUB_API_BASE_URL:
        process.env.REEF_GITHUB_API_BASE_URL ??
        `${options.fixtureOrigin}/github`,
      REEF_GITHUB_APP_ID: process.env.REEF_GITHUB_APP_ID ?? "123456",
      REEF_GITHUB_APP_INSTALLATION_ID:
        process.env.REEF_GITHUB_APP_INSTALLATION_ID ?? "789",
      REEF_GITHUB_APP_PRIVATE_KEY:
        process.env.REEF_GITHUB_APP_PRIVATE_KEY ?? E2E_GITHUB_APP_PRIVATE_KEY,
    },
  );
  await waitForOk(options.webOrigin, 120_000);

  const payload = buildReadyPayload({
    webOrigin: options.webOrigin,
    fixtureOrigin: options.fixtureOrigin,
    scenario: resetBody.scenario,
  });
  if (options.readyFile) await writeReadyFile(options.readyFile, payload);
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function main() {
  process.on("SIGINT", () => shutdown(130));
  process.on("SIGTERM", () => shutdown(143));
  readyFilePath = process.env.REEF_E2E_READY_FILE ?? null;
  try {
    const options = parseOptions();
    await startRuntime(options);
    process.stdout.write(
      `${[
        `[dev:e2e] open ${options.webOrigin} in a real web browser`,
        `[dev:e2e] reset fixture: pnpm --filter @reef/web run reset:e2e -- ${options.scenario}`,
      ].join("\n")}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[dev:e2e] ${message}\n`);
    shutdown(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === MODULE_PATH) {
  void main();
}
