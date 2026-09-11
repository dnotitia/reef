#!/usr/bin/env node

/**
 * Test-only live runtime for REEF-621.
 *
 * Reef owns the browser app and this fixture control plane. AKB remains the
 * real data plane: this process starts the pinned AKB runtime, creates a
 * private role fixture through its public APIs, and never substitutes an
 * admin token for a user request. Runtime state, the AKB checkout, logs, and
 * all credentials stay outside the Reef checkout and are never published in
 * the descriptor.
 */

import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { chmod, cp, mkdir, readFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import net from "node:net";

const MODULE_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(MODULE_PATH), "../..");
const WEB_PACKAGE_ROOT = join(REPO_ROOT, "packages", "web");
const CORE_DIST = join(REPO_ROOT, "packages", "core", "dist", "index.js");

export const AKB_REPOSITORY = "https://github.com/dnotitia/akb.git";
export const AKB_REVISION = "6ce81347c946982e58c2d860f8fce40563cce275";
export const LIVE_SCENARIO = "notifications-rbac";
export const PASSWORD_ENV = "REEF_E2E_PASSWORD";
export const WEB_LOGIN_PATH = "/api/auth/akb/login";
export const FAULT_KINDS = Object.freeze([
  "empty_notifications",
  "missing_notifications_table",
  "incompatible_notifications_schema",
  "data_permission_denied",
]);

class RuntimeFailure extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RuntimeFailure";
  }
}

function fail(message) {
  throw new RuntimeFailure(message);
}

function validateScenario(value) {
  if (value !== LIVE_SCENARIO) {
    fail(`scenario must be ${LIVE_SCENARIO}`);
  }
  return value;
}

export function parseOptions(argv = process.argv.slice(2), env = process.env) {
  const args = [...argv];
  const mode = args.shift();
  if (mode !== "serve") {
    fail(
      "usage: live-notifications-runtime.mjs serve --scenario notifications-rbac",
    );
  }

  let scenario = env.CRABBOX_RUNTIME_SCENARIO ?? LIVE_SCENARIO;
  let runtimeRoot = env.REEF_LIVE_NOTIFICATIONS_RUNTIME_ROOT ?? null;
  let akbCheckout = env.REEF_AKB_CHECKOUT ?? null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--scenario") {
      scenario = args[index + 1];
      if (!scenario) fail("--scenario requires a value");
      index += 1;
      continue;
    }
    if (arg === "--runtime-root") {
      runtimeRoot = args[index + 1];
      if (!runtimeRoot) fail("--runtime-root requires a path");
      index += 1;
      continue;
    }
    if (arg === "--akb-checkout") {
      akbCheckout = args[index + 1];
      if (!akbCheckout) fail("--akb-checkout requires a path");
      index += 1;
      continue;
    }
    fail(`unknown runtime option: ${arg}`);
  }

  validateScenario(scenario);
  return {
    mode,
    scenario,
    runtimeRoot,
    akbCheckout,
  };
}

function executable(name) {
  const result = spawnSync("which", [name], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  const path = result.stdout.trim();
  return path.length > 0 ? path : null;
}

function commandVersion(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function redactEnvironment(environment) {
  const sanitized = { ...environment };
  for (const key of [
    PASSWORD_ENV,
    "AKB_E2E_USERNAME",
    "AKB_E2E_PASSWORD",
    "AKB_E2E_PAT",
    "REEF_AKB_ADMIN_PASSWORD",
    "REEF_AKB_ADMIN_USERNAME",
  ]) {
    delete sanitized[key];
  }
  return sanitized;
}

async function makePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

function assertOutsideRepo(path, label) {
  const resolved = resolve(path);
  const relation = relative(REPO_ROOT, resolved);
  if (relation === "" || !(relation === ".." || relation.startsWith("../"))) {
    fail(`${label} must be outside the Reef checkout`);
  }
  return resolved;
}

function appendLog(logPath, line) {
  const stream = createWriteStream(logPath, { flags: "a", mode: 0o600 });
  stream.end(`${line}\n`);
}

function runLoggedCommand(command, args, { cwd, env, logPath }) {
  return new Promise((resolvePromise, reject) => {
    const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    let settled = false;
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      log.end();
      callback();
    };
    child.once("error", (error) => {
      settle(() =>
        reject(
          new RuntimeFailure(`command could not start: ${command}`, {
            cause: error,
          }),
        ),
      );
    });
    child.once("close", (code, signal) => {
      settle(() => {
        if (code === 0) {
          resolvePromise();
          return;
        }
        reject(
          new RuntimeFailure(
            `${command} exited unsuccessfully (${code ?? `signal:${signal ?? "unknown"}`})`,
          ),
        );
      });
    });
  });
}

async function resolveToolchain(runtimeRoot, logsDir) {
  const node = executable("node");
  if (!node) fail("Node.js is required by the live runtime");
  const expectedNode = (
    await readFile(join(REPO_ROOT, ".node-version"), "utf8")
  ).trim();
  if (commandVersion(node, ["--version"]) !== `v${expectedNode}`) {
    fail(`Node.js ${expectedNode} is required by the Reef checkout`);
  }

  let pnpm = executable("pnpm");
  if (!pnpm) {
    const corepack = executable("corepack");
    if (!corepack) fail("pnpm or corepack is required by the live runtime");
    const toolchainBin = await makePrivateDirectory(
      join(runtimeRoot, "toolchain", "bin"),
    );
    await runLoggedCommand(
      corepack,
      ["enable", "--install-directory", toolchainBin],
      {
        cwd: REPO_ROOT,
        env: redactEnvironment(process.env),
        logPath: join(logsDir, "toolchain.log"),
      },
    );
    process.env.PATH = `${toolchainBin}:${process.env.PATH ?? ""}`;
    pnpm = executable("pnpm");
  }
  if (!pnpm) fail("pnpm was not available after corepack setup");
  const packageJson = JSON.parse(
    await readFile(join(REPO_ROOT, "package.json"), "utf8"),
  );
  const expectedPnpm = String(packageJson.packageManager ?? "").replace(
    /^pnpm@/u,
    "",
  );
  if (!expectedPnpm || commandVersion(pnpm, ["--version"]) !== expectedPnpm) {
    fail(
      `pnpm ${expectedPnpm || "from package.json"} is required by the Reef checkout`,
    );
  }
  return { node, pnpm };
}

async function allocatePort() {
  const server = net.createServer();
  server.unref();
  server.listen({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
  if (!port) fail("could not allocate a loopback port");
  return port;
}

async function allocatePorts() {
  const values = await Promise.all(
    Array.from({ length: 5 }, () => allocatePort()),
  );
  return {
    akbApp: values[0],
    akbFixture: values[1],
    akbEmbed: values[2],
    web: values[3],
    fixture: values[4],
  };
}

function gitHead(checkout) {
  const result = spawnSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function ensureAkbCheckout(options, runtimeRoot, logsDir) {
  if (options.akbCheckout) {
    const checkout = assertOutsideRepo(options.akbCheckout, "AKB checkout");
    if (gitHead(checkout) !== AKB_REVISION) {
      fail(`AKB checkout is not pinned to ${AKB_REVISION}`);
    }
    return checkout;
  }

  const checkout = join(runtimeRoot, "akb-source");
  await runLoggedCommand(
    "git",
    ["clone", "--filter=blob:none", "--no-checkout", AKB_REPOSITORY, checkout],
    {
      cwd: runtimeRoot,
      env: redactEnvironment(process.env),
      logPath: join(logsDir, "akb-source.log"),
    },
  );
  await runLoggedCommand(
    "git",
    ["-C", checkout, "checkout", "--detach", AKB_REVISION],
    {
      cwd: runtimeRoot,
      env: redactEnvironment(process.env),
      logPath: join(logsDir, "akb-source.log"),
    },
  );
  if (gitHead(checkout) !== AKB_REVISION) {
    fail(`cloned AKB source is not pinned to ${AKB_REVISION}`);
  }
  return checkout;
}

class ProcessManager {
  constructor(logsDir) {
    this.logsDir = logsDir;
    this.entries = [];
    this.onExit = null;
    this.stopping = false;
  }

  start(name, command, args, { cwd, env, captureStdout = false } = {}) {
    const logPath = join(this.logsDir, `${name}.log`);
    const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: captureStdout ? ["ignore", "pipe", "pipe"] : ["ignore", log, log],
    });
    if (captureStdout) child.stderr.pipe(log, { end: false });
    const entry = { name, child, log };
    this.entries.push(entry);
    child.once("exit", (code, signal) => {
      if (captureStdout && child.stderr) child.stderr.unpipe(log);
      log.end();
      if (!this.stopping && this.onExit) this.onExit(name, code, signal);
    });
    child.once("error", (error) => {
      if (!this.stopping && this.onExit) {
        this.onExit(
          name,
          null,
          error instanceof Error ? error.message : "error",
        );
      }
    });
    return entry;
  }

  async stopAll() {
    this.stopping = true;
    for (const entry of [...this.entries].reverse()) {
      await terminateProcess(entry.child);
    }
    this.entries = [];
  }
}

async function terminateProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      return;
    }
  }
  await Promise.race([
    once(child, "exit"),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 10_000)),
  ]);
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The child already exited between the checks.
    }
  }
}

function waitForAkbDescriptor(entry, logPath) {
  if (!entry.child.stdout) fail("AKB bootstrap did not expose stdout");
  return new Promise((resolvePromise, reject) => {
    let buffer = "";
    let settled = false;
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };
    entry.child.stdout.setEncoding("utf8");
    entry.child.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 2 * 1024 * 1024) {
        settle(() =>
          reject(
            new RuntimeFailure(
              "AKB ready descriptor exceeded the safety bound",
            ),
          ),
        );
        return;
      }
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const descriptor = JSON.parse(line);
          if (
            descriptor?.schema_version === 2 &&
            descriptor?.status === "ready"
          ) {
            settle(() => resolvePromise(descriptor));
            return;
          }
        } catch {
          // The AKB supervisor's stdout contract is one JSON descriptor. Do
          // not mirror malformed or unexpected output into parent stdout.
          appendLog(logPath, "ignored non-descriptor AKB stdout");
        }
      }
    });
    entry.child.once("error", () =>
      settle(() => reject(new RuntimeFailure("AKB bootstrap failed to start"))),
    );
    entry.child.once("exit", () =>
      settle(() =>
        reject(new RuntimeFailure("AKB bootstrap exited before readiness")),
      ),
    );
  });
}

async function waitForHttp(url, predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      const body = await response.text();
      if (predicate(response.status, body)) return;
    } catch {
      // Readiness is polled until the bounded deadline. Details stay in the
      // child log rather than being copied into a public error response.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  fail(`service did not become ready: ${new URL(url).pathname}`);
}

async function requestJson(url, { method = "GET", token, body } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new RuntimeFailure(
      `AKB request could not reach ${new URL(url).pathname}`,
      { cause: error },
    );
  }
  const text = await response.text();
  if (!response.ok) {
    throw new RuntimeFailure(
      `${method} ${new URL(url).pathname} returned ${response.status}`,
    );
  }
  try {
    return text.length > 0 ? JSON.parse(text) : null;
  } catch (error) {
    throw new RuntimeFailure(
      `AKB request returned invalid JSON for ${new URL(url).pathname}`,
      { cause: error },
    );
  }
}

async function loginAkb(akbOrigin, username, password) {
  const result = await requestJson(`${akbOrigin}/api/v1/auth/login`, {
    method: "POST",
    body: { username, password },
  });
  if (typeof result?.token !== "string" || result.token.length === 0) {
    fail("AKB login did not return a session token");
  }
  return result.token;
}

function tableItems(payload) {
  return Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.tables)
      ? payload.tables
      : Array.isArray(payload)
        ? payload
        : [];
}

async function sql(adapter, vault, statement, params = []) {
  return adapter.request(`/api/v1/tables/${encodeURIComponent(vault)}/sql`, {
    method: "POST",
    body: { sql: statement, params },
  });
}

function decodeJsonValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function errorStatus(error) {
  if (!error || typeof error !== "object") return null;
  const context = error.context;
  if (
    context &&
    typeof context === "object" &&
    typeof context.status === "number"
  ) {
    return context.status;
  }
  return typeof error.status === "number" ? error.status : null;
}

async function observeStatus(operation) {
  try {
    await operation();
    return 200;
  } catch (error) {
    return errorStatus(error);
  }
}

function publicRole(role, username, vault) {
  return {
    username,
    role,
    start_path: `/workspace/${vault}/inbox`,
    login: {
      service: "reef-web",
      method: "POST",
      path: WEB_LOGIN_PATH,
      username,
      password_env: PASSWORD_ENV,
    },
  };
}

export function buildDiscovery({
  scenario = LIVE_SCENARIO,
  vault,
  webOrigin,
  fixtureOrigin,
  roles,
  permissionChecks,
  activeFault = null,
  candidateRevision = "unknown",
}) {
  validateScenario(scenario);
  return {
    schema_version: 2,
    status: "ready",
    scenario,
    workspace: {
      vault,
      inbox_start_path: `/workspace/${vault}/inbox`,
    },
    credentials: {
      password_env: PASSWORD_ENV,
      username_source: "roles.<role>.username",
      login_path: WEB_LOGIN_PATH,
    },
    roles: {
      reader: publicRole("reader", roles.reader, vault),
      writer: publicRole("writer", roles.writer, vault),
      owner: publicRole("owner", roles.owner, vault),
    },
    expected: {
      reader: { unread: 1, read: 1, state_update_status: 403 },
      writer: { unread: 1, state_update_status: 200 },
      owner: { unread: 1, state_update_status: 200 },
      recipient_scope: "server actor only; request recipient is ignored",
    },
    permission_checks: permissionChecks,
    controls: {
      reset: {
        service: "fixture",
        method: "POST",
        path: "/reset",
        content_type: "application/json",
        body: { scenario },
      },
      fault: {
        service: "fixture",
        method: "POST",
        path: "/control",
        content_type: "application/json",
        body: {
          action: "fault",
          kind: "missing_notifications_table|incompatible_notifications_schema|data_permission_denied|empty_notifications",
          enabled: true,
        },
        kinds: [...FAULT_KINDS],
      },
    },
    observability: {
      service: "fixture",
      method: "GET",
      path: "/observe",
      credential_free: true,
      exposes: [
        "notification states",
        "role names",
        "schema columns",
        "schema version stamp",
      ],
    },
    runtime: {
      candidate_revision: candidateRevision,
      akb_source_revision: AKB_REVISION,
      akb_source_repository: AKB_REPOSITORY,
      origins: { reef_web: webOrigin, fixture: fixtureOrigin },
      secrets:
        "credentials are supplied through the password environment only and are absent from discovery",
    },
    active_fault: activeFault,
  };
}

export function buildReadyDescriptor({
  scenario = LIVE_SCENARIO,
  webOrigin,
  akbOrigin,
  fixtureOrigin,
  candidateRevision = "unknown",
}) {
  validateScenario(scenario);
  return {
    schema_version: 2,
    status: "ready",
    scenario,
    services: {
      web: {
        origin: webOrigin,
        health: { method: "GET", url: `${webOrigin}/api/healthz` },
      },
      app: {
        origin: akbOrigin,
        health: { method: "GET", url: `${akbOrigin}/readyz` },
        discovery: { method: "GET", url: `${akbOrigin}/openapi.json` },
      },
      fixture: {
        origin: fixtureOrigin,
        health: { method: "GET", url: `${fixtureOrigin}/health` },
        reset: {
          method: "POST",
          url: `${fixtureOrigin}/reset`,
          content_type: "application/json",
          body: { scenario },
        },
        discovery: { method: "GET", url: `${fixtureOrigin}/discover` },
        control: {
          method: "POST",
          url: `${fixtureOrigin}/control`,
          content_type: "application/json",
        },
        observe: { method: "GET", url: `${fixtureOrigin}/observe` },
      },
    },
    credentials: {
      password_env: PASSWORD_ENV,
      login_path: WEB_LOGIN_PATH,
    },
    evidence: {
      candidate_revision: candidateRevision,
      akb_source_revision: AKB_REVISION,
      akb_source_repository: AKB_REPOSITORY,
      scenario,
      data_plane: "real AKB backend with PostgreSQL/pgvector",
      fixture: "test-only role and notification fixture",
      secret_policy:
        "no password, session, token, or administrator credential is included",
    },
  };
}

class NotificationFixture {
  constructor(core, config) {
    this.core = core;
    this.scenario = LIVE_SCENARIO;
    this.webOrigin = config.webOrigin;
    this.fixtureOrigin = config.fixtureOrigin;
    this.vault = config.vault;
    this.roles = config.roles;
    this.ownerAdapter = config.ownerAdapter;
    this.readerAdapter = config.readerAdapter;
    this.writerAdapter = config.writerAdapter;
    this.permissionChecks = null;
    this.baselineSchema = null;
    this.activeFault = null;
    this.webReady = false;
    this.lock = Promise.resolve();
    this.notificationKeys = {};
  }

  static async create(core, config) {
    const roles = {
      owner: `${config.namespace}-owner`,
      reader: `${config.namespace}-reader`,
      writer: `${config.namespace}-writer`,
    };
    for (const [role, username] of Object.entries(roles)) {
      await requestJson(`${config.akbOrigin}/api/v1/auth/register`, {
        method: "POST",
        body: {
          username,
          email: `${username}@invalid.test`,
          password: config.password,
          display_name: `Reef live ${role}`,
        },
      });
    }
    const ownerToken = await loginAkb(
      config.akbOrigin,
      roles.owner,
      config.password,
    );
    const readerToken = await loginAkb(
      config.akbOrigin,
      roles.reader,
      config.password,
    );
    const writerToken = await loginAkb(
      config.akbOrigin,
      roles.writer,
      config.password,
    );
    const ownerAdapter = core.createAkbAdapter({
      baseUrl: config.akbOrigin,
      jwt: ownerToken,
    });
    const readerAdapter = core.createAkbAdapter({
      baseUrl: config.akbOrigin,
      jwt: readerToken,
    });
    const writerAdapter = core.createAkbAdapter({
      baseUrl: config.akbOrigin,
      jwt: writerToken,
    });

    await core.akbCreateVault({
      adapter: ownerAdapter,
      name: config.vault,
      description: "Test-only Reef notification RBAC workspace",
    });
    await core.akbGrantVaultMember({
      adapter: ownerAdapter,
      vault: config.vault,
      user: roles.reader,
      role: "reader",
    });
    await core.akbGrantVaultMember({
      adapter: ownerAdapter,
      vault: config.vault,
      user: roles.writer,
      role: "writer",
    });
    await core.akbEnsureReefTables({
      adapter: ownerAdapter,
      vault: config.vault,
    });
    await core.akbWriteConfig({
      adapter: ownerAdapter,
      vault: config.vault,
      config: {
        project_prefix: "REEF",
        monitored_repos: [],
        authoring_language: "en",
        stale_hide_completed_days: 28,
        stale_hide_canceled_days: 7,
      },
      message: "Initialize live notification fixture",
    });

    const fixture = new NotificationFixture(core, {
      ...config,
      roles,
      ownerAdapter,
      readerAdapter,
      writerAdapter,
    });
    await fixture.seedIssueAndComment();
    await fixture.seedNotifications();
    fixture.permissionChecks = await fixture.verifyPermissions();
    fixture.baselineSchema = await fixture.schemaSummary();
    await fixture.setOldSchemaStamp();
    return fixture;
  }

  async seedIssueAndComment() {
    const now = new Date().toISOString();
    await this.core.akbWriteIssue({
      adapter: this.ownerAdapter,
      vault: this.vault,
      issue: {
        id: "REEF-001",
        title: "Notification permission fixture",
        status: "in_progress",
        created_at: now,
        created_by: this.roles.owner,
        updated_at: now,
        updated_by: this.roles.owner,
        issue_type: "task",
        priority: "medium",
        labels: [],
        depends_on: [],
        related_to: [],
        blocks: [],
        mention_recipients: [],
        source: "runtime-fixture",
        last_status_change: now,
      },
      content:
        "# Notification permission fixture\n\nThis issue is backed by the live AKB fixture.\n",
    });
    const comment = await this.core.akbCreateComment(
      this.ownerAdapter,
      this.vault,
      "REEF-001",
      "A real comment in the live notification fixture.",
      this.roles.writer,
    );
    this.commentId = comment.id;
  }

  async seedNotifications() {
    await sql(this.ownerAdapter, this.vault, "DELETE FROM reef_notifications");
    const at = new Date().toISOString();
    const readerPrimary = await this.core.akbCreateNotification(
      this.ownerAdapter,
      this.vault,
      {
        recipient: this.roles.reader,
        reefId: "REEF-001",
        sourceType: "comment",
        sourceRef: this.commentId,
        eventType: "comment_created",
        actor: this.roles.writer,
        occurredAt: at,
      },
    );
    const readerRead = await this.core.akbCreateNotification(
      this.ownerAdapter,
      this.vault,
      {
        recipient: this.roles.reader,
        reefId: "REEF-001",
        sourceType: "activity",
        sourceRef: "reader-read-fixture",
        eventType: "status_change",
        actor: this.roles.owner,
        occurredAt: new Date(Date.now() - 1_000).toISOString(),
      },
    );
    const writer = await this.core.akbCreateNotification(
      this.ownerAdapter,
      this.vault,
      {
        recipient: this.roles.writer,
        reefId: "REEF-001",
        sourceType: "activity",
        sourceRef: "writer-state-fixture",
        eventType: "status_change",
        actor: this.roles.owner,
        occurredAt: new Date(Date.now() - 2_000).toISOString(),
      },
    );
    const owner = await this.core.akbCreateNotification(
      this.ownerAdapter,
      this.vault,
      {
        recipient: this.roles.owner,
        reefId: "REEF-001",
        sourceType: "activity",
        sourceRef: "owner-state-fixture",
        eventType: "status_change",
        actor: this.roles.owner,
        occurredAt: new Date(Date.now() - 3_000).toISOString(),
      },
    );
    await sql(
      this.ownerAdapter,
      this.vault,
      "UPDATE reef_notifications SET state = $1, read_at = $2 WHERE notification_key = $3",
      ["read", new Date().toISOString(), readerRead.notification_key],
    );
    this.notificationKeys = {
      readerPrimary: readerPrimary.notification_key,
      readerRead: readerRead.notification_key,
      writer: writer.notification_key,
      owner: owner.notification_key,
    };
  }

  async verifyPermissions() {
    const readerSelect = await observeStatus(() =>
      sql(
        this.readerAdapter,
        this.vault,
        "SELECT notification_key FROM reef_notifications WHERE recipient = $1 LIMIT 1",
        [this.roles.reader],
      ),
    );
    const readerUpdate = await observeStatus(() =>
      sql(
        this.readerAdapter,
        this.vault,
        "UPDATE reef_notifications SET state = $1 WHERE notification_key = $2 AND recipient = $3",
        ["read", this.notificationKeys.readerPrimary, this.roles.reader],
      ),
    );
    const writerUpdate = await observeStatus(() =>
      this.core.akbUpdateNotificationState(this.writerAdapter, this.vault, {
        notificationKey: this.notificationKeys.writer,
        recipient: this.roles.writer,
        state: "read",
      }),
    );
    if (readerSelect !== 200 || readerUpdate !== 403 || writerUpdate !== 200) {
      fail(
        "AKB notification role preflight did not prove reader SELECT/writer DML boundaries",
      );
    }
    await this.seedNotifications();
    return {
      reader_select: readerSelect,
      reader_update: readerUpdate,
      writer_update: writerUpdate,
    };
  }

  async setOldSchemaStamp() {
    const stamp = {
      version: 2,
      applied_at: new Date().toISOString(),
    };
    await sql(
      this.ownerAdapter,
      this.vault,
      "DELETE FROM reef_settings WHERE key = $1",
      ["schema_version"],
    );
    await sql(
      this.ownerAdapter,
      this.vault,
      "INSERT INTO reef_settings (key, value) VALUES ($1, $2::jsonb)",
      ["schema_version", JSON.stringify(stamp)],
    );
  }

  async schemaSummary() {
    const payload = await this.ownerAdapter.request(
      `/api/v1/tables/${encodeURIComponent(this.vault)}`,
    );
    const tables = tableItems(payload)
      .filter((table) => table && typeof table.name === "string")
      .map((table) => ({
        name: table.name,
        columns: Array.isArray(table.columns)
          ? table.columns
              .map((column) => column?.name)
              .filter((name) => typeof name === "string")
              .sort()
          : [],
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const notification = tables.find(
      (table) => table.name === "reef_notifications",
    );
    return {
      table_names: tables.map((table) => table.name),
      notification_columns: notification?.columns ?? null,
    };
  }

  async schemaVersion() {
    try {
      const result = await sql(
        this.ownerAdapter,
        this.vault,
        "SELECT value FROM reef_settings WHERE key = $1 LIMIT 1",
        ["schema_version"],
      );
      const item = result?.items?.[0];
      const decoded = decodeJsonValue(item?.value);
      return decoded &&
        typeof decoded === "object" &&
        typeof decoded.version === "number"
        ? decoded.version
        : null;
    } catch {
      return null;
    }
  }

  async notificationSummary() {
    try {
      const result = await sql(
        this.ownerAdapter,
        this.vault,
        "SELECT recipient, state, COUNT(*) AS count FROM reef_notifications GROUP BY recipient, state ORDER BY recipient, state",
      );
      return {
        status: "ready",
        counts: (result?.items ?? []).map((item) => ({
          recipient: item.recipient,
          state: item.state,
          count: Number(item.count),
        })),
      };
    } catch {
      return { status: "unavailable", counts: [] };
    }
  }

  async membersSummary() {
    try {
      const result = await this.ownerAdapter.request(
        `/api/v1/vaults/${encodeURIComponent(this.vault)}/members`,
      );
      return (result?.members ?? [])
        .map((member) => ({ username: member.username, role: member.role }))
        .filter(
          (member) =>
            typeof member.username === "string" &&
            typeof member.role === "string",
        )
        .sort((left, right) => left.username.localeCompare(right.username));
    } catch {
      return [];
    }
  }

  async observe() {
    const schema = await this.schemaSummary().catch(() => ({
      table_names: [],
      notification_columns: null,
    }));
    return {
      status: "ready",
      scenario: this.scenario,
      web_ready: this.webReady,
      workspace: this.vault,
      roles: {
        reader: this.roles.reader,
        writer: this.roles.writer,
        owner: this.roles.owner,
      },
      members: await this.membersSummary(),
      permission_checks: this.permissionChecks,
      active_fault: this.activeFault,
      schema_version: await this.schemaVersion(),
      schema,
      baseline_schema: this.baselineSchema,
      notifications: await this.notificationSummary(),
      credential_free: true,
    };
  }

  discovery() {
    return buildDiscovery({
      scenario: this.scenario,
      vault: this.vault,
      webOrigin: this.webOrigin,
      fixtureOrigin: this.fixtureOrigin,
      roles: this.roles,
      permissionChecks: this.permissionChecks,
      activeFault: this.activeFault,
      candidateRevision: gitHead(REPO_ROOT) ?? "unknown",
    });
  }

  health() {
    return {
      status: this.webReady ? "ready" : "starting",
      scenario: this.scenario,
      web_ready: this.webReady,
      akb_source_revision: AKB_REVISION,
    };
  }

  async withLock(operation) {
    const previous = this.lock;
    let release;
    this.lock = new Promise((resolvePromise) => {
      release = resolvePromise;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async dropNotificationsTable() {
    const schema = await this.schemaSummary();
    if (!schema.table_names.includes("reef_notifications")) return;
    await this.ownerAdapter.request(
      `/api/v1/tables/${encodeURIComponent(this.vault)}/reef_notifications`,
      { method: "DELETE" },
    );
  }

  async createIncompatibleNotificationsTable() {
    await this.ownerAdapter.request(
      `/api/v1/tables/${encodeURIComponent(this.vault)}`,
      {
        method: "POST",
        body: {
          name: "reef_notifications",
          columns: [
            { name: "notification_key", type: "text", required: true },
            { name: "recipient", type: "text", required: true },
            { name: "reef_id", type: "text", required: true },
            { name: "source_type", type: "text", required: true },
            { name: "source_ref", type: "text", required: true },
            { name: "event_type", type: "text", required: true },
            { name: "actor", type: "text", required: true },
            { name: "occurred_at", type: "timestamp", required: true },
          ],
        },
      },
    );
    await sql(
      this.ownerAdapter,
      this.vault,
      "INSERT INTO reef_notifications (notification_key, recipient, reef_id, source_type, source_ref, event_type, actor, occurred_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        "incompatible-notification-fixture",
        this.roles.reader,
        "REEF-001",
        "activity",
        "incompatible-schema-fixture",
        "status_change",
        this.roles.writer,
        new Date().toISOString(),
      ],
    );
  }

  async resetUnlocked() {
    if (
      this.activeFault === "missing_notifications_table" ||
      this.activeFault === "incompatible_notifications_schema"
    ) {
      await this.dropNotificationsTable();
    }
    if (this.activeFault === "data_permission_denied") {
      await this.core.akbGrantVaultMember({
        adapter: this.ownerAdapter,
        vault: this.vault,
        user: this.roles.reader,
        role: "reader",
      });
    }
    await this.core.akbEnsureReefTables({
      adapter: this.ownerAdapter,
      vault: this.vault,
    });
    await this.seedNotifications();
    await this.setOldSchemaStamp();
    this.activeFault = null;
  }

  async reset() {
    return this.withLock(async () => {
      await this.resetUnlocked();
      return { status: "ready", scenario: this.scenario, active_fault: null };
    });
  }

  async setFault(kind, enabled = true) {
    if (!FAULT_KINDS.includes(kind))
      fail("unsupported notification fixture fault");
    return this.withLock(async () => {
      if (!enabled) {
        await this.resetUnlocked();
        return { status: "ready", scenario: this.scenario, active_fault: null };
      }
      if (this.activeFault !== null) await this.resetUnlocked();
      if (kind === "missing_notifications_table") {
        await this.dropNotificationsTable();
      } else if (kind === "incompatible_notifications_schema") {
        await this.dropNotificationsTable();
        await this.createIncompatibleNotificationsTable();
      } else if (kind === "empty_notifications") {
        await sql(
          this.ownerAdapter,
          this.vault,
          "DELETE FROM reef_notifications",
        );
      } else if (kind === "data_permission_denied") {
        await this.core.akbRevokeVaultMember({
          adapter: this.ownerAdapter,
          vault: this.vault,
          user: this.roles.reader,
        });
      }
      this.activeFault = kind;
      return { status: "ready", scenario: this.scenario, active_fault: kind };
    });
  }

  async control(body) {
    if (!body || typeof body !== "object")
      fail("fixture control body is invalid");
    if (body.action === "reset") return this.reset();
    if (body.action !== "fault")
      fail("unsupported notification fixture control action");
    return this.setFault(body.kind, body.enabled !== false);
  }
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) fail("fixture control body is too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail("fixture control body is not valid JSON");
  }
}

function sendJson(response, status, value) {
  const payload = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function startFixtureServer(fixture, port) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "127.0.0.1"}`,
      );
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, fixture.health());
        return;
      }
      if (request.method === "GET" && url.pathname === "/discover") {
        sendJson(response, 200, fixture.discovery());
        return;
      }
      if (request.method === "GET" && url.pathname === "/observe") {
        sendJson(response, 200, await fixture.observe());
        return;
      }
      if (request.method === "POST" && url.pathname === "/reset") {
        const body = await readBody(request);
        if (body.scenario !== fixture.scenario) {
          sendJson(response, 422, { error: "scenario_mismatch" });
          return;
        }
        sendJson(response, 200, await fixture.reset());
        return;
      }
      if (request.method === "POST" && url.pathname === "/control") {
        sendJson(response, 200, await fixture.control(await readBody(request)));
        return;
      }
      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      const status = error instanceof RuntimeFailure ? 400 : 500;
      sendJson(response, status, {
        error:
          status === 400 ? "invalid_fixture_control" : "fixture_control_error",
      });
    }
  });
  server.keepAliveTimeout = 30_000;
  server.headersTimeout = 31_000;
  server.listen({ host: "127.0.0.1", port });
  await once(server, "listening");
  return server;
}

async function buildReefRuntime(pnpm, logsDir, env) {
  await runLoggedCommand(pnpm, ["install", "--frozen-lockfile"], {
    cwd: REPO_ROOT,
    env,
    logPath: join(logsDir, "pnpm-install.log"),
  });
  await runLoggedCommand(pnpm, ["--filter", "@reef/core", "run", "build"], {
    cwd: REPO_ROOT,
    env,
    logPath: join(logsDir, "core-build.log"),
  });
  await runLoggedCommand(pnpm, ["run", "build"], {
    cwd: REPO_ROOT,
    env,
    logPath: join(logsDir, "reef-build.log"),
  });

  const standaloneRoot = join(
    WEB_PACKAGE_ROOT,
    ".next",
    "standalone",
    "packages",
    "web",
  );
  const standaloneStatic = join(standaloneRoot, ".next", "static");
  await rm(standaloneStatic, { recursive: true, force: true });
  await cp(join(WEB_PACKAGE_ROOT, ".next", "static"), standaloneStatic, {
    recursive: true,
  });
  const standalonePublic = join(standaloneRoot, "public");
  await rm(standalonePublic, { recursive: true, force: true });
  await cp(join(WEB_PACKAGE_ROOT, "public"), standalonePublic, {
    recursive: true,
  });
}

function runtimeNamespace() {
  return `reef-live-${randomBytes(8).toString("hex")}`;
}

async function main() {
  const options = parseOptions();
  const runtimeRoot = assertOutsideRepo(
    options.runtimeRoot ??
      join(
        tmpdir(),
        `reef-live-notifications-${process.pid}-${randomBytes(4).toString("hex")}`,
      ),
    "runtime root",
  );
  await makePrivateDirectory(runtimeRoot);
  const logsDir = await makePrivateDirectory(join(runtimeRoot, "logs"));
  const akbRuntimeRoot = await makePrivateDirectory(
    join(runtimeRoot, "akb-runtime"),
  );
  const password = process.env[PASSWORD_ENV];
  if (typeof password !== "string" || password.length === 0) {
    fail(`${PASSWORD_ENV} is required`);
  }

  const toolchain = await resolveToolchain(runtimeRoot, logsDir);
  const buildEnv = redactEnvironment(process.env);
  buildEnv.CI = buildEnv.CI ?? "1";
  await buildReefRuntime(toolchain.pnpm, logsDir, buildEnv);
  const akbCheckout = await ensureAkbCheckout(options, runtimeRoot, logsDir);
  const ports = await allocatePorts();
  const manager = new ProcessManager(logsDir);
  let fixtureServer;
  let fixture;
  let signalHandler;
  try {
    const adminUsername = `${runtimeNamespace()}-bootstrap`;
    const adminPassword = randomBytes(32).toString("base64url");
    const akbEnv = redactEnvironment(process.env);
    akbEnv.AKB_E2E_USERNAME = adminUsername;
    akbEnv.AKB_E2E_PASSWORD = adminPassword;
    const akbEntry = manager.start(
      "akb-runtime",
      "bash",
      [
        join(akbCheckout, "scripts", "ci", "ubuntu_e2e_bootstrap.sh"),
        "serve",
        "--scenario",
        "empty",
        "--checkout",
        akbCheckout,
        "--runtime-root",
        akbRuntimeRoot,
        "--app-port",
        String(ports.akbApp),
        "--fixture-port",
        String(ports.akbFixture),
        "--embed-port",
        String(ports.akbEmbed),
      ],
      { cwd: runtimeRoot, env: akbEnv, captureStdout: true },
    );
    const akbDescriptor = await waitForAkbDescriptor(
      akbEntry,
      join(logsDir, "akb-runtime.log"),
    );
    const akbOrigin = akbDescriptor?.services?.app?.origin;
    if (typeof akbOrigin !== "string")
      fail("AKB runtime descriptor did not expose its app origin");

    const core = await import(pathToFileURL(CORE_DIST).href);
    const namespace = runtimeNamespace();
    const vault = `${namespace}-vault`;
    const webOrigin = `http://127.0.0.1:${ports.web}`;
    const fixtureOrigin = `http://127.0.0.1:${ports.fixture}`;
    fixture = await NotificationFixture.create(core, {
      akbOrigin,
      webOrigin,
      fixtureOrigin,
      vault,
      password,
      namespace,
    });
    fixtureServer = await startFixtureServer(fixture, ports.fixture);

    const webEnv = redactEnvironment(process.env);
    webEnv.NODE_ENV = "production";
    webEnv.PORT = String(ports.web);
    webEnv.HOSTNAME = "127.0.0.1";
    webEnv.AKB_BACKEND_URL = akbOrigin;
    webEnv.AKB_WEB_URL = akbOrigin;
    webEnv.REEF_E2E_LLM_DISABLED = "1";
    webEnv.NEXT_TELEMETRY_DISABLED = "1";
    const webEntry = manager.start(
      "reef-web",
      toolchain.node,
      [
        join(
          WEB_PACKAGE_ROOT,
          ".next",
          "standalone",
          "packages",
          "web",
          "server.js",
        ),
      ],
      { cwd: REPO_ROOT, env: webEnv },
    );
    await waitForHttp(`${webOrigin}/api/healthz`, (status) => status === 200);
    if (webEntry.child.exitCode !== null)
      fail("Reef web exited before the live descriptor was published");
    fixture.webReady = true;

    const candidateRevision = gitHead(REPO_ROOT) ?? "unknown";
    process.stdout.write(
      `${JSON.stringify(
        buildReadyDescriptor({
          scenario: options.scenario,
          webOrigin,
          akbOrigin,
          fixtureOrigin,
          candidateRevision,
        }),
      )}\n`,
    );

    await new Promise((resolvePromise, reject) => {
      signalHandler = () => resolvePromise();
      process.once("SIGINT", signalHandler);
      process.once("SIGTERM", signalHandler);
      manager.onExit = (name) => {
        reject(
          new RuntimeFailure(`${name} exited while the runtime was ready`),
        );
      };
    });
  } finally {
    if (signalHandler) {
      process.removeListener("SIGINT", signalHandler);
      process.removeListener("SIGTERM", signalHandler);
    }
    manager.onExit = null;
    if (fixtureServer) {
      await new Promise((resolvePromise) =>
        fixtureServer.close(() => resolvePromise()),
      );
    }
    await manager.stopAll();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === MODULE_PATH) {
  main().catch((error) => {
    const message =
      error instanceof RuntimeFailure
        ? error.message
        : "live notification runtime failed";
    process.stderr.write(`[reef-live-notifications] ${message}\n`);
    process.exitCode = 1;
  });
}
