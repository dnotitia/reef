#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  behaviorReason,
  createFixtureControl,
  loginToWorkspace,
  redactText,
} = require("../tests/e2e/behaviors/runtime.cjs");
const {
  CONTENT_SEARCH_CLAUSE,
  runContentSearchBehavior,
} = require("../tests/e2e/behaviors/content-search.cjs");
const {
  LARGE_ISSUE_LIST_CLAUSES,
  runLargeIssueListBehavior,
} = require("../tests/e2e/behaviors/issue-list-virtualization.cjs");
const {
  NAMED_FILTER_CLAUSE,
  NAMED_FILTER_CLAUSES,
  runNamedIssueFiltersBehavior,
} = require("../tests/e2e/behaviors/named-issue-filters.cjs");

const SCRIPT_PATH = __filename;
const PLAYWRIGHT_VERSION = "1.59.1";
const PNPM_VERSION = "11.10.0";
const BEHAVIORS = [
  "content-search",
  "issue-list-virtualization",
  "named-issue-filters",
];
const RESET_SCENARIOS = [
  "empty",
  "configured",
  "content_search",
  "configured_multi",
  "demo_board",
  "raw_only",
  "activity_suggestions",
  "notifications",
  "skill_outdated",
  "comment_mentions",
  "large_vault",
];
const EVIDENCE_TYPES = ["screenshot", "accessibility", "details"];
const usage = `Usage:
  canonical-e2e-artifact.cjs pack --output PATH
  canonical-e2e-artifact.cjs --input-dir PATH --output-dir PATH --candidate-head SHA

The input directory contains behavior-input.json with only canonical behavior,
contract, runtime bindings, credential environment names, and evidence names.
`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertRecord(value, name) {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `invalid ${name}`,
  );
}

function assertExactKeys(value, keys, name) {
  assertRecord(value, name);
  for (const key of Object.keys(value)) {
    assert(keys.includes(key), `${name} contains unsupported field: ${key}`);
  }
}

function text(value, name, maximum) {
  assert(
    typeof value === "string" && value.length > 0 && value.length <= maximum,
    `invalid ${name}`,
  );
  assert(!/\p{Cc}/u.test(value), `${name} contains control characters`);
  return value;
}

function environmentName(value) {
  const name = text(value, "credential environment name", 120);
  assert(/^[A-Z_][A-Z0-9_]*$/u.test(name), "invalid environment-variable name");
  return name;
}

function origin(value, name) {
  const raw = text(value, name, 2_000);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`invalid ${name}`);
  }
  assert(
    parsed.protocol === "http:" || parsed.protocol === "https:",
    `${name} must use HTTP(S)`,
  );
  assert(
    !parsed.username && !parsed.password,
    `${name} must not contain credentials`,
  );
  assert(
    parsed.pathname === "/" && !parsed.search && !parsed.hash,
    `${name} must be an origin without a path or query`,
  );
  return parsed.origin;
}

function workspaceName(value) {
  const workspace = text(value, "workspace", 120);
  assert(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(workspace),
    "invalid workspace",
  );
  return workspace;
}

function validateBehaviorInput(raw) {
  assertExactKeys(
    raw,
    [
      "schema_version",
      "behavior",
      "contract_clause",
      "runtime",
      "credentials",
      "evidence",
    ],
    "behavior input",
  );
  assert(raw.schema_version === 1, "unsupported behavior input schema");
  assert(BEHAVIORS.includes(raw.behavior), "unsupported canonical behavior");
  assert(raw.contract_clause === "B2", "unsupported behavior contract clause");

  assertExactKeys(
    raw.runtime,
    ["web_origin", "fixture_origin", "workspace", "reset_scenario"],
    "runtime",
  );
  const runtime = {
    web_origin: origin(raw.runtime.web_origin, "web_origin"),
    fixture_origin: origin(raw.runtime.fixture_origin, "fixture_origin"),
    workspace: workspaceName(raw.runtime.workspace),
    reset_scenario: text(raw.runtime.reset_scenario, "reset_scenario", 80),
  };
  assert(
    RESET_SCENARIOS.includes(runtime.reset_scenario),
    "unsupported fixture reset scenario",
  );

  assertExactKeys(
    raw.credentials,
    ["username_env", "password_env"],
    "credentials",
  );
  const credentials = {
    username_env: environmentName(raw.credentials.username_env),
    password_env: environmentName(raw.credentials.password_env),
  };
  assert(
    credentials.username_env !== credentials.password_env,
    "credential environment names must be distinct",
  );

  assert(
    Array.isArray(raw.evidence) && raw.evidence.length > 0,
    "evidence must be a non-empty array",
  );
  const evidence = [...new Set(raw.evidence)];
  assert(
    evidence.length === raw.evidence.length,
    "evidence contains duplicates",
  );
  assert(
    evidence.every((item) => EVIDENCE_TYPES.includes(item)),
    "unsupported evidence requirement",
  );

  return {
    schema_version: 1,
    behavior: raw.behavior,
    contract_clause: "B2",
    runtime,
    credentials,
    evidence,
  };
}

function clauseIds(behavior) {
  if (behavior === "content-search") return [CONTENT_SEARCH_CLAUSE];
  if (behavior === "named-issue-filters") return NAMED_FILTER_CLAUSES;
  return LARGE_ISSUE_LIST_CLAUSES;
}

function blockedBehavior(message, reason) {
  const error = new Error(message);
  error.behavior_reason = reason;
  return error;
}

function reportReason(status, reason) {
  return status === "blocked" ? reason : null;
}

function buildBehaviorReport({ candidateHead, status, reason, clauses }) {
  assert(/^[0-9a-f]{40,64}$/iu.test(candidateHead), "invalid candidate head");
  assert(
    ["pass", "fail", "blocked"].includes(status),
    "invalid behavior status",
  );
  assert(
    Array.isArray(clauses) && clauses.length > 0,
    "behavior clauses are required",
  );
  return {
    candidate_head: candidateHead,
    status,
    reason: reportReason(status, reason),
    clauses,
  };
}

async function packCanonicalArtifact(outputPath) {
  const target = resolve(outputPath);
  assert(
    target !== resolve(SCRIPT_PATH),
    "artifact must not replace its source",
  );
  const existing = await lstat(target).catch(() => null);
  assert(!existing?.isSymbolicLink(), "artifact output must not be a symlink");
  await mkdir(dirname(target), { recursive: true });
  const { build } = require("esbuild");
  await build({
    entryPoints: [SCRIPT_PATH],
    outfile: target,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["@playwright/test", "esbuild"],
    sourcemap: false,
    legalComments: "none",
  });
  await chmod(target, 0o755);
  const sha256 = createHash("sha256")
    .update(await readFile(target))
    .digest("hex");
  return { path: target, sha256 };
}

async function writePrivate(path, content) {
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function ensurePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

async function saveEvidence(outputDir, input, observation, page) {
  const evidence = [];
  const stem = input.behavior;
  if (input.evidence.includes("screenshot")) {
    const path = `${stem}.png`;
    await page.screenshot({ path: join(outputDir, path), fullPage: false });
    await chmod(join(outputDir, path), 0o600);
    evidence.push(path);
  }
  if (input.evidence.includes("accessibility")) {
    const path = `${stem}.aria.txt`;
    const accessibleText = await page.locator("body").ariaSnapshot();
    await writePrivate(join(outputDir, path), `${accessibleText ?? ""}\n`);
    evidence.push(path);
  }
  if (input.evidence.includes("details")) {
    const path = `${stem}.json`;
    const details = {
      behavior: input.behavior,
      observation: observation?.details ?? null,
    };
    await writePrivate(
      join(outputDir, path),
      `${JSON.stringify(details, null, 2)}\n`,
    );
    evidence.push(path);
  }
  return evidence;
}

function clausesForObservation(
  input,
  observation,
  status,
  observable,
  reason,
  evidence,
  failedClauses,
  secrets,
) {
  if (Array.isArray(failedClauses) && failedClauses.length > 0) {
    return failedClauses.map((clause) => ({
      id: clause.id,
      status: clause.status,
      ...(clause.status === "blocked" && clause.reason
        ? { reason: clause.reason }
        : {}),
      observable: redactText(String(clause.observable), secrets),
      evidence,
    }));
  }
  if (status === "pass" && Array.isArray(observation?.details?.clauses)) {
    return observation.details.clauses.map((clause) => ({
      id: clause.id,
      status: "pass",
      observable: clause.observable,
      evidence,
    }));
  }
  return clauseIds(input.behavior).map((id) => ({
    id,
    status,
    ...(status === "blocked" && reason ? { reason } : {}),
    observable: redactText(observable, secrets),
    evidence,
  }));
}

async function runBehaviorArtifact(options) {
  const outputDir = resolve(options.outputDir);
  await ensurePrivateDirectory(outputDir);
  const transcript = [];
  const secrets = [];
  let input;
  let phase = "input";
  let status = "blocked";
  let reason = "blocked_tooling";
  let observable = "Artifact setup did not complete.";
  let observation;
  let page;
  let browser;
  let browserContext;
  let requestContext;
  let runtime;
  let evidence = [];
  let failedClauses;

  try {
    const inputPath = resolve(options.inputDir, "behavior-input.json");
    const info = await lstat(inputPath);
    assert(
      info.isFile() && !info.isSymbolicLink(),
      "behavior-input.json must be a regular file",
    );
    input = validateBehaviorInput(
      JSON.parse(await readFile(inputPath, "utf8")),
    );
    const processState = globalThis.process;
    const environment = processState.env;
    const loginName = environment[input.credentials.username_env] ?? "";
    const loginCode = environment[input.credentials.password_env] ?? "";
    secrets.push(loginName, loginCode);
    if (!loginName || !loginCode) {
      throw blockedBehavior(
        "declared credential variables are required",
        "blocked_external_auth",
      );
    }

    runtime = await loadPlaywright();
    requestContext = await runtime.request.newContext({
      ignoreHTTPSErrors: true,
    });
    const fixture = createFixtureControl(
      requestContext,
      input.runtime.fixture_origin,
    );
    await fixture.reset(input.runtime.reset_scenario);
    browser = await runtime.chromium.launch({ headless: true });
    browserContext = await browser.newContext({
      baseURL: input.runtime.web_origin,
      ignoreHTTPSErrors: true,
    });
    page = await browserContext.newPage();
    phase = "login";
    transcript.push({ event: "login.started", behavior: input.behavior });
    const credentials = { username: loginName, password: loginCode };
    await loginToWorkspace(page, {
      webOrigin: input.runtime.web_origin,
      workspace: input.runtime.workspace,
      credentials,
    });
    transcript.push({
      event: "login.completed",
      behavior: input.behavior,
      status: "ok",
    });
    phase = "behavior";
    if (input.behavior === "content-search") {
      observation = await runContentSearchBehavior({
        page,
        context: browserContext,
        expect: runtime.expect,
        workspace: input.runtime.workspace,
      });
    } else if (input.behavior === "issue-list-virtualization") {
      observation = await runLargeIssueListBehavior({
        page,
        context: browserContext,
        expect: runtime.expect,
        fixture,
        relogin: (targetPage = page) =>
          loginToWorkspace(targetPage, {
            webOrigin: input.runtime.web_origin,
            workspace: input.runtime.workspace,
            credentials,
          }),
        workspace: input.runtime.workspace,
      });
      page = observation.page ?? page;
    } else {
      observation = await runNamedIssueFiltersBehavior({
        page,
        expect: runtime.expect,
        workspace: input.runtime.workspace,
        relogin: () =>
          loginToWorkspace(page, {
            webOrigin: input.runtime.web_origin,
            workspace: input.runtime.workspace,
            credentials,
          }),
      });
    }
    status = "pass";
    reason = undefined;
    observable = observation.observable;
    transcript.push({
      event: "behavior.completed",
      behavior: input.behavior,
      status,
    });
  } catch (error) {
    const inferredReason = behaviorReason(error);
    status = inferredReason
      ? "blocked"
      : phase === "behavior"
        ? "fail"
        : "blocked";
    reason =
      inferredReason ?? (status === "blocked" ? "blocked_tooling" : undefined);
    observable = redactText(
      error instanceof Error ? error.message : String(error),
      secrets,
    );
    if (Array.isArray(error?.behavior_clauses)) {
      failedClauses = error.behavior_clauses;
    }
    transcript.push({
      event: "behavior.error",
      behavior: input?.behavior ?? "unknown",
      status,
      ...(reason ? { reason } : {}),
      message: observable,
    });
  }

  if (page && input) {
    try {
      evidence = await saveEvidence(outputDir, input, observation, page);
    } catch (error) {
      const message = redactText(
        error instanceof Error ? error.message : String(error),
        secrets,
      );
      transcript.push({
        event: "evidence.error",
        behavior: input.behavior,
        message,
      });
    }
  }

  await browserContext?.close().catch(() => undefined);
  await requestContext?.dispose().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await runtime?.cleanup().catch(() => undefined);

  const transcriptPath = "redacted-transcript.jsonl";
  const transcriptText = transcript
    .map((entry) => redactText(JSON.stringify(entry), secrets))
    .join("\n");
  await writePrivate(
    join(outputDir, transcriptPath),
    `${transcriptText}${transcriptText ? "\n" : ""}`,
  );
  evidence = [...evidence, transcriptPath];
  const reportInput = input ?? {
    behavior: "content-search",
  };
  const clauses = clausesForObservation(
    reportInput,
    observation,
    status,
    observable,
    reason,
    evidence,
    failedClauses,
    secrets,
  );
  const report = buildBehaviorReport({
    candidateHead: options.candidateHead,
    status,
    reason,
    clauses,
  });
  await writePrivate(
    join(outputDir, "behavior-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(
    `behavior report: ${join(outputDir, "behavior-report.json")}\n`,
  );
  process.stdout.write(`behavior status: ${status}\n`);
  return report;
}

async function loadPlaywright() {
  try {
    const module = await import("@playwright/test");
    return {
      chromium: module.chromium,
      expect: module.expect,
      request: module.request,
      cleanup: async () => undefined,
    };
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/Cannot find package|ERR_MODULE_NOT_FOUND/u.test(error.message)
    ) {
      throw error;
    }
  }

  const root = await mkdtemp(join(tmpdir(), "reef-canonical-e2e-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      private: true,
      packageManager: `pnpm@${PNPM_VERSION}`,
      dependencies: { "@playwright/test": PLAYWRIGHT_VERSION },
    }),
    { mode: 0o600 },
  );
  await run("corepack", ["install", "--global", `pnpm@${PNPM_VERSION}`]);
  await run("corepack", [
    "pnpm",
    "install",
    "--dir",
    root,
    "--prod",
    "--ignore-scripts",
    "--frozen-lockfile=false",
    "--store-dir",
    join(root, ".pnpm-store"),
  ]);
  const module = await import(
    pathToFileURL(
      join(root, "node_modules", "@playwright", "test", "index.mjs"),
    ).href
  );
  return {
    chromium: module.chromium,
    expect: module.expect,
    request: module.request,
    cleanup: () => rm(root, { force: true, recursive: true }),
  };
}

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolvePromise()
        : reject(
            new Error(
              `${command} failed with ${signal ?? `exit code ${code ?? 1}`}`,
            ),
          ),
    );
  });
}

function option(args, name) {
  const index = args.indexOf(name);
  const value = args[index + 1];
  assert(index >= 0 && value && !value.startsWith("--"), `${name} is required`);
  return value;
}

function parseArgs(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.includes("--help") || args.includes("-h")) {
    return { command: "help" };
  }
  if (args[0] === "pack") {
    assert(
      args.length === 3 && args[1] === "--output",
      "pack requires only --output PATH",
    );
    return { command: "pack", output: option(args, "--output") };
  }
  assert(
    args.length === 6,
    "run requires --input-dir, --output-dir, and --candidate-head",
  );
  const candidateHead = option(args, "--candidate-head");
  assert(/^[0-9a-f]{40,64}$/iu.test(candidateHead), "invalid --candidate-head");
  return {
    command: "run",
    inputDir: option(args, "--input-dir"),
    outputDir: option(args, "--output-dir"),
    candidateHead,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help") {
    process.stdout.write(usage);
    return;
  }
  if (options.command === "pack") {
    process.stdout.write(
      `${JSON.stringify(await packCanonicalArtifact(options.output))}\n`,
    );
    return;
  }
  const report = await runBehaviorArtifact(options);
  if (report.status === "fail") process.exitCode = 1;
}

module.exports = {
  BEHAVIORS,
  LARGE_ISSUE_LIST_CLAUSES,
  NAMED_FILTER_CLAUSES,
  NAMED_FILTER_CLAUSE,
  buildBehaviorReport,
  packCanonicalArtifact,
  parseArgs,
  redactText,
  reportReason,
  runBehaviorArtifact,
  validateBehaviorInput,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
