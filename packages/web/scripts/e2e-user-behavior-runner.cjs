#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  chmod,
  copyFile,
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

const SCRIPT_PATH = __filename;
const PLAYWRIGHT_VERSION = "1.59.1";
const PNPM_VERSION = "11.10.0";
const usage = `Usage:
  e2e-user-behavior-runner.cjs pack --output PATH
  e2e-user-behavior-runner.cjs --input-dir PATH --output-dir PATH --candidate-head SHA
`;

/**
 * @typedef {object} GlobalSearchScenario
 * @property {1} schema_version
 * @property {"global-search-content"} scenario
 * @property {string} clause_id
 * @property {string} target_url
 * @property {string} workspace
 * @property {string} search_placeholder
 * @property {string} metadata_query
 * @property {string} content_query
 * @property {{username_env: string, password_env: string}} credentials
 * @property {{field_heading: string, content_heading: string, issue_id: string, title: string, source: string, snippet: string}} expected
 */

/**
 * @typedef {object} LargeIssueListScenario
 * @property {1} schema_version
 * @property {"large-issue-list"} scenario
 * @property {string} clause_id
 * @property {string} target_url
 * @property {string} workspace
 * @property {{username_env: string, password_env: string}} credentials
 * @property {{focus_issue_id: string, keyboard_steps: number, max_mounted_rows: number, min_scroll_height: number}} expected
 */

/**
 * The hermetic content-search spec and portable artifact share this one
 * user-facing action instead of defining an action language or second harness.
 *
 * @param {import("@playwright/test").Page} page
 * @param {GlobalSearchScenario} scenario
 */
async function observeGlobalSearchContent(page, scenario) {
  await page.keyboard.press("Control+K");
  const input = page.getByPlaceholder(scenario.search_placeholder, {
    exact: true,
  });
  await input.waitFor({ state: "visible", timeout: 15_000 });
  await input.fill(scenario.metadata_query);
  await visibleText(page, scenario.expected.field_heading);
  await input.fill(scenario.content_query);
  await visibleText(page, scenario.expected.content_heading);

  const row = page
    .getByRole("option")
    .filter({
      has: page.getByText(scenario.expected.issue_id, { exact: true }),
    })
    .first();
  await row.waitFor({ state: "visible", timeout: 15_000 });
  const source = row.getByText(scenario.expected.source, { exact: true });
  const snippet = row.getByText(scenario.expected.snippet, { exact: false });
  await source.waitFor({ state: "visible" });
  await snippet.waitFor({ state: "visible" });

  const style = await source.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      background: computed.backgroundColor,
      borders: [
        computed.borderTopWidth,
        computed.borderRightWidth,
        computed.borderBottomWidth,
        computed.borderLeftWidth,
      ],
      radius: computed.borderRadius,
    };
  });
  assert(style.background === "rgba(0, 0, 0, 0)", "source has a background");
  assert(
    style.borders.every((width) => width === "0px"),
    "source has a border",
  );
  assert(style.radius === "0px", "source has a rounded container");

  const snippetHandle = await snippet.elementHandle();
  assert(snippetHandle, "content snippet element disappeared");
  const sourceFirst = await source.evaluate(
    (sourceElement, snippetElement) =>
      Boolean(
        sourceElement.compareDocumentPosition(snippetElement) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    snippetHandle,
  );
  await snippetHandle.dispose();
  assert(sourceFirst, "source provenance does not precede its snippet");

  const accessibleText = await row.ariaSnapshot();
  assertTextOrder(accessibleText, [
    scenario.expected.issue_id,
    scenario.expected.title,
    scenario.expected.source,
    scenario.expected.snippet,
  ]);
  assert(!accessibleText.includes("·"), "decorative separator is accessible");
  return { accessibleText, row };
}

/**
 * Keep the portable large-list scenario narrow: it observes the real List
 * surface, its first-page/cursor requests, bounded DOM rows, and keyboard focus
 * movement. Failure injection and residual-filter cases remain in the
 * repository-owned hermetic spec where the fixture control endpoints are
 * available.
 *
 * @param {import("@playwright/test").Page} page
 * @param {LargeIssueListScenario} scenario
 */
async function observeLargeIssueList(page, scenario) {
  const requests = [];
  const responses = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/issues") {
      requests.push(url.toString());
    }
  });
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (
      response.request().method() !== "GET" ||
      url.pathname !== "/api/issues" ||
      !response.ok()
    ) {
      return;
    }
    try {
      const body = await response.json();
      responses.push({
        url: url.toString(),
        ids: Array.isArray(body?.issues)
          ? body.issues
              .map((issue) => issue?.id)
              .filter((id) => typeof id === "string")
          : [],
      });
    } catch {
      // A non-JSON response is not usable as list continuation evidence.
    }
  });

  const workspace = `/workspace/${encodeURIComponent(scenario.workspace)}/issues?view=list`;
  await page.goto(new URL(workspace, scenario.target_url).toString(), {
    waitUntil: "domcontentloaded",
  });

  const rows = page.locator('[data-testid="issue-list-row"]');
  await rows.first().waitFor({ state: "visible", timeout: 20_000 });
  const initialRequest = requests.find((raw) => {
    const url = new URL(raw);
    return (
      !url.searchParams.has("cursor") && url.searchParams.get("limit") === "100"
    );
  });
  assert(initialRequest, "initial issue list request was not observed");
  assert(
    new URL(initialRequest).searchParams.get("limit") === "100",
    "initial issue list request did not use limit=100",
  );
  const initialRowCount = await rows.count();
  assert(
    initialRowCount <= scenario.expected.max_mounted_rows,
    `too many mounted issue rows: ${initialRowCount}`,
  );

  const scroll = page.getByTestId("issue-list-scroll-container");
  const range = await scroll.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  assert(
    range.scrollHeight >= scenario.expected.min_scroll_height,
    `list scroll range is too small: ${range.scrollHeight}`,
  );

  await rows.first().focus();

  const cursorRequest = page.waitForRequest(
    (request) => {
      const url = new URL(request.url());
      return (
        request.method() === "GET" &&
        url.pathname === "/api/issues" &&
        url.searchParams.has("cursor")
      );
    },
    { timeout: 20_000 },
  );
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await cursorRequest;
  await page.waitForTimeout(300);
  const cursorRequests = requests.filter((raw) =>
    new URL(raw).searchParams.has("cursor"),
  );
  assert(
    cursorRequests.length === 1,
    `expected one cursor request, observed ${cursorRequests.length}`,
  );
  const initialPage = responses.find(
    ({ url }) => !new URL(url).searchParams.has("cursor"),
  );
  const cursorPage = responses.find(({ url }) =>
    new URL(url).searchParams.has("cursor"),
  );
  assert(initialPage && cursorPage, "list page responses were not observed");
  const initialTailIds = initialPage.ids.slice(-5);
  assert(
    cursorPage.ids.every((id) => !initialPage.ids.includes(id)),
    "cursor page repeats an issue from the initial page",
  );
  const mountedIds = await rows.evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-issue-id")),
  );
  assert(
    new Set(mountedIds).size === mountedIds.length,
    "mounted issue rows contain duplicate ids",
  );

  for (let index = 0; index < scenario.expected.keyboard_steps; index += 1) {
    await page.keyboard.press("j");
  }
  const focused = page.locator(
    `[data-issue-id="${scenario.expected.focus_issue_id}"]`,
  );
  await focused.waitFor({ state: "visible", timeout: 20_000 });
  assert(
    (await focused.getAttribute("data-keyboard-focused")) === "true",
    "keyboard target did not own list focus",
  );
  assert(
    (await focused.getAttribute("tabindex")) === "0",
    "keyboard target did not own the roving tab stop",
  );

  return {
    accessibleText: await focused.ariaSnapshot(),
    requestSummary: requests.map((raw) => {
      const url = new URL(raw);
      return {
        url: `${url.pathname}${url.search}`,
        path: url.pathname,
        limit: url.searchParams.get("limit"),
        has_cursor: url.searchParams.has("cursor"),
      };
    }),
    initial_tail_ids: initialTailIds,
    cursor_page_ids: cursorPage.ids,
    rowCount: mountedIds.length,
    scrollHeight: range.scrollHeight,
  };
}

/** @param {unknown} raw */
function validateScenarioInput(raw) {
  assertRecord(raw, "scenario.json");
  assert(raw.schema_version === 1, "schema_version must be 1");
  assert(
    raw.scenario === "global-search-content" ||
      raw.scenario === "large-issue-list",
    "scenario must be global-search-content or large-issue-list",
  );
  assertRecord(raw.credentials, "credentials");
  assertRecord(raw.expected, "expected");

  const target = new URL(text(raw.target_url, "target_url", 2048));
  assert(
    /^https?:$/u.test(target.protocol),
    "target_url must use http or https",
  );
  assert(
    !(target.username || target.password || target.search || target.hash),
    "target_url must not contain credentials, query, or fragment",
  );
  const clauseId = text(raw.clause_id, "clause_id", 80);
  assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(clauseId), "invalid clause_id");

  const credentials = {
    username_env: environmentName(raw.credentials.username_env),
    password_env: environmentName(raw.credentials.password_env),
  };
  if (raw.scenario === "large-issue-list") {
    const keyboardSteps = Number(raw.expected.keyboard_steps);
    const maxMountedRows = Number(raw.expected.max_mounted_rows);
    const minScrollHeight = Number(raw.expected.min_scroll_height);
    assert(
      Number.isInteger(keyboardSteps) && keyboardSteps > 0,
      "invalid keyboard_steps",
    );
    assert(
      Number.isInteger(maxMountedRows) && maxMountedRows > 0,
      "invalid max_mounted_rows",
    );
    assert(
      Number.isInteger(minScrollHeight) && minScrollHeight > 0,
      "invalid min_scroll_height",
    );
    return /** @type {LargeIssueListScenario} */ ({
      schema_version: 1,
      scenario: "large-issue-list",
      clause_id: clauseId,
      target_url: target.origin,
      workspace: text(raw.workspace, "workspace", 160),
      credentials,
      expected: {
        focus_issue_id: text(
          raw.expected.focus_issue_id,
          "focus_issue_id",
          120,
        ),
        keyboard_steps: keyboardSteps,
        max_mounted_rows: maxMountedRows,
        min_scroll_height: minScrollHeight,
      },
    });
  }

  return /** @type {GlobalSearchScenario} */ ({
    schema_version: 1,
    scenario: "global-search-content",
    clause_id: clauseId,
    target_url: target.origin,
    workspace: text(raw.workspace, "workspace", 160),
    search_placeholder: text(raw.search_placeholder, "search_placeholder", 200),
    metadata_query: text(raw.metadata_query, "metadata_query", 500),
    content_query: text(raw.content_query, "content_query", 500),
    credentials,
    expected: {
      field_heading: text(raw.expected.field_heading, "field_heading", 300),
      content_heading: text(
        raw.expected.content_heading,
        "content_heading",
        300,
      ),
      issue_id: text(raw.expected.issue_id, "issue_id", 120),
      title: text(raw.expected.title, "title", 500),
      source: text(raw.expected.source, "source", 120),
      snippet: text(raw.expected.snippet, "snippet", 1000),
    },
  });
}

/** @param {string} value @param {string[]} secrets */
function redactText(value, secrets) {
  return secrets
    .filter(Boolean)
    .reduce((result, secret) => result.replaceAll(secret, "[REDACTED]"), value);
}

/** @param {string} outputPath */
async function packRunnerArtifact(outputPath) {
  const target = resolve(outputPath);
  assert(
    target !== resolve(SCRIPT_PATH),
    "artifact must not replace its source",
  );
  await mkdir(dirname(target), { recursive: true });
  await copyFile(SCRIPT_PATH, target);
  await chmod(target, 0o755);
  const sha256 = createHash("sha256")
    .update(await readFile(target))
    .digest("hex");
  return { path: target, sha256 };
}

async function runScenario(options) {
  const outputDir = resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const transcript = [];
  const evidence = [];
  const secrets = [];
  let clauseId = "runner-input";
  let phase = "setup";
  let status = "blocked";
  let observable = "Runner setup did not complete.";
  let browser;
  let runtime;

  try {
    const inputPath = resolve(options.inputDir, "scenario.json");
    const inputInfo = await lstat(inputPath);
    assert(
      inputInfo.isFile() && !inputInfo.isSymbolicLink(),
      "scenario.json must be a regular file",
    );
    const scenario = validateScenarioInput(
      JSON.parse(await readFile(inputPath, "utf8")),
    );
    clauseId = scenario.clause_id;
    const username = process.env[scenario.credentials.username_env] ?? "";
    const password = process.env[scenario.credentials.password_env] ?? "";
    secrets.push(username, password);
    assert(username && password, "declared credential variables are required");

    runtime = await loadPlaywright();
    browser = await runtime.chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    transcript.push({ event: "login.opened" });
    await page.goto(new URL("/login", scenario.target_url).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-testid="akb-login-form"]')
      .waitFor({ state: "visible", timeout: 20_000 });
    await page.locator('[data-testid="login-username"]').fill(username);
    await page.locator('[data-testid="login-password"]').fill(password);
    const login = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/akb/login" &&
        response.request().method() === "POST",
    );
    await page.locator('[data-testid="login-submit"]').click();
    const loginResponse = await login;
    assert(loginResponse.ok(), `login returned HTTP ${loginResponse.status()}`);
    await page.waitForURL((url) => url.pathname !== "/login", {
      timeout: 15_000,
    });
    transcript.push({
      event: "login.completed",
      status: loginResponse.status(),
    });

    phase = "behavior";
    let observation;
    if (scenario.scenario === "large-issue-list") {
      observation = await observeLargeIssueList(page, scenario);
    } else {
      const workspace = `/workspace/${encodeURIComponent(scenario.workspace)}/issues`;
      await page.goto(new URL(workspace, scenario.target_url).toString(), {
        waitUntil: "domcontentloaded",
      });
      observation = await observeGlobalSearchContent(page, scenario);
    }
    transcript.push({
      event: "workspace.opened",
      workspace: scenario.workspace,
    });
    transcript.push(
      scenario.scenario === "large-issue-list"
        ? {
            event: "large-issue-list.observed",
            row_count: observation.rowCount,
            scroll_height: observation.scrollHeight,
            requests: observation.requestSummary,
          }
        : {
            event: "global-search.observed",
            issue_id: scenario.expected.issue_id,
            source: scenario.expected.source,
          },
    );

    phase = "evidence";
    const evidenceName =
      scenario.scenario === "large-issue-list"
        ? "large-issue-list"
        : "global-search";
    await page.screenshot({
      path: join(outputDir, `${evidenceName}.png`),
      fullPage: true,
    });
    await chmod(join(outputDir, `${evidenceName}.png`), 0o600);
    await writePrivate(
      join(outputDir, `${evidenceName}.aria.txt`),
      `${observation.accessibleText}\n`,
    );
    evidence.push(`${evidenceName}.png`, `${evidenceName}.aria.txt`);
    if (scenario.scenario === "large-issue-list") {
      await writePrivate(
        join(outputDir, `${evidenceName}.requests.json`),
        `${JSON.stringify(observation.requestSummary, null, 2)}\n`,
      );
      evidence.push(`${evidenceName}.requests.json`);
    }
    await context.close();
    status = "pass";
    observable =
      scenario.scenario === "large-issue-list"
        ? `Signed in, observed a bounded virtualized issue list with a ${observation.scrollHeight}px scroll range, and moved keyboard focus to the configured offscreen issue.`
        : "Signed in, opened global search, and observed the configured field and content result in accessible order.";
  } catch (error) {
    status = phase === "behavior" ? "fail" : "blocked";
    observable = redactText(
      error instanceof Error ? error.message : String(error),
      secrets,
    );
    transcript.push({ event: "scenario.error", status, message: observable });
  } finally {
    await browser?.close().catch(() => undefined);
    await runtime?.cleanup().catch(() => undefined);
  }

  await writePrivate(
    join(outputDir, "redacted-transcript.jsonl"),
    `${transcript.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
  evidence.push("redacted-transcript.jsonl");
  await writePrivate(
    join(outputDir, "behavior-report.json"),
    `${JSON.stringify(
      {
        candidate_head: options.candidateHead,
        status,
        clauses: [{ id: clauseId, status, observable, evidence }],
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `behavior report: ${join(outputDir, "behavior-report.json")}\n`,
  );
}

async function loadPlaywright() {
  try {
    const module = await import("@playwright/test");
    return { chromium: module.chromium, cleanup: async () => undefined };
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/Cannot find package|ERR_MODULE_NOT_FOUND/u.test(error.message)
    ) {
      throw error;
    }
  }

  const root = await mkdtemp(join(tmpdir(), "reef-e2e-runner-"));
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
    cleanup: () => rm(root, { force: true, recursive: true }),
  };
}

function parseArgs(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.includes("--help") || args.includes("-h"))
    return { command: "help" };
  if (args[0] === "pack") {
    return { command: "pack", output: option(args, "--output") };
  }
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
  if (options.command === "help") return process.stdout.write(usage);
  if (options.command === "pack") {
    return process.stdout.write(
      `${JSON.stringify(await packRunnerArtifact(options.output))}\n`,
    );
  }
  await runScenario(options);
}

async function run(command, args) {
  await new Promise((done, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? done(undefined)
        : reject(
            new Error(
              `${command} failed with ${signal ?? `exit code ${code ?? 1}`}`,
            ),
          ),
    );
  });
}

async function writePrivate(path, content) {
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

function option(args, name) {
  const value = args[args.indexOf(name) + 1];
  assert(args.includes(name) && value, `${name} is required`);
  return value;
}

function environmentName(value) {
  const name = text(value, "credential environment name", 120);
  assert(/^[A-Z_][A-Z0-9_]*$/u.test(name), "invalid environment-variable name");
  return name;
}

function text(value, name, max) {
  assert(
    typeof value === "string" && value.length > 0 && value.length <= max,
    `invalid ${name}`,
  );
  assert(!/\p{Cc}/u.test(value), `${name} contains control characters`);
  return value;
}

function assertRecord(value, name) {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `invalid ${name}`,
  );
}

function assertTextOrder(value, ordered) {
  let cursor = 0;
  for (const part of ordered) {
    const index = value.indexOf(part, cursor);
    assert(
      index >= cursor,
      `accessible option text is missing or misorders ${part}`,
    );
    cursor = index + part.length;
  }
}

async function visibleText(page, value) {
  await page.getByText(value, { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

module.exports = {
  observeGlobalSearchContent,
  observeLargeIssueList,
  packRunnerArtifact,
  redactText,
  validateScenarioInput,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
