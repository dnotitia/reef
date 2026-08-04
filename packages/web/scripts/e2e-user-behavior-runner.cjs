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
 * @typedef {object} CommentMentionsScenario
 * @property {1} schema_version
 * @property {"comment-mentions"} scenario
 * @property {string} clause_id
 * @property {string} target_url
 * @property {string} workspace
 * @property {string} issue_id
 * @property {string} composer_label
 * @property {string} trigger
 * @property {string} submit_label
 * @property {string} edit_label
 * @property {string} edit_draft_label
 * @property {string} edit_submit_label
 * @property {{username_env: string, password_env: string}} credentials
 * @property {{option_label: string, token: string, body: string, canonical_body: string, visible_label: string}} expected
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
 * @param {import("@playwright/test").Page} page
 * @param {CommentMentionsScenario} scenario
 */
async function observeCommentMentions(page, scenario) {
  const composer = page.getByRole("textbox", {
    name: scenario.composer_label,
    exact: true,
  });
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await composer.fill(scenario.trigger);

  const option = page.getByRole("option", {
    name: scenario.expected.option_label,
    exact: true,
  });
  await option.waitFor({ state: "visible", timeout: 15_000 });
  await composer.press("Enter");
  assert(
    (await composer.inputValue()) === scenario.expected.body,
    "autocomplete did not insert the expected visible exact-case label",
  );
  assert(
    !/[{}\\]/u.test(await composer.inputValue()),
    "composer exposed canonical mention syntax",
  );

  const createResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/comments") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: scenario.submit_label, exact: true })
    .last()
    .click();
  const created = await createResponse;
  assert(created.ok(), `comment create returned HTTP ${created.status()}`);
  const createdPayload = await created.json();
  assert(
    createdPayload?.comment?.body === scenario.expected.canonical_body,
    "comment API did not receive the canonical persisted body",
  );
  const mention = page.locator("[data-reef-mention]").last();
  await mention.waitFor({ state: "visible", timeout: 15_000 });
  assert(
    (await mention.textContent()) === scenario.expected.visible_label,
    "rendered mention label does not match the stored token",
  );
  const rendered = await mention.evaluate((element) => ({
    tag: element.tagName,
    link: element.closest("a") !== null,
    token: element.getAttribute("data-reef-mention"),
  }));
  assert(rendered.tag === "SPAN", "mention is not rendered as a span");
  assert(!rendered.link, "mentions must not be clickable");
  assert(
    rendered.token === scenario.expected.visible_label.slice(1),
    "rendered mention projection does not match the canonical username",
  );
  const style = await mention.evaluate((element) => {
    const computed = getComputedStyle(element);
    const root = element.closest(".comment-mention-renderer");
    const probe = document.createElement("span");
    probe.style.color = "var(--brand)";
    root?.append(probe);
    const brandColor = getComputedStyle(probe).color;
    probe.remove();
    return {
      fontWeight: Number.parseInt(computed.fontWeight, 10),
      color: computed.color,
      brandColor,
    };
  });
  assert(style.fontWeight >= 500, "rendered mention is not medium weight");
  assert(
    style.color === style.brandColor,
    "rendered mention does not use the Reef brand color",
  );

  const editButton = page
    .getByRole("button", {
      name: scenario.edit_label,
      exact: true,
    })
    .last();
  await editButton.click();
  const editDraft = page.getByRole("textbox", {
    name: scenario.edit_draft_label,
    exact: true,
  });
  await editDraft.waitFor({ state: "visible", timeout: 15_000 });
  assert(
    (await editDraft.inputValue()) === scenario.expected.visible_label,
    "edit draft did not restore the visible mention label",
  );
  assert(
    !/[{}\\]/u.test(await editDraft.inputValue()),
    "edit draft exposed canonical mention syntax",
  );
  await editDraft.fill(scenario.trigger);
  await page
    .getByRole("option", { name: scenario.expected.option_label, exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await editDraft.press("Enter");
  assert(
    (await editDraft.inputValue()) === scenario.expected.body,
    "edit autocomplete did not insert the visible mention label",
  );
  const updateResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.includes("/comments/") &&
      response.request().method() === "PATCH",
  );
  await page
    .getByRole("button", { name: scenario.edit_submit_label, exact: true })
    .click();
  const updated = await updateResponse;
  assert(updated.ok(), `comment update returned HTTP ${updated.status()}`);
  const updatedPayload = await updated.json();
  assert(
    updatedPayload?.comment?.body === scenario.expected.canonical_body,
    "comment update API did not receive the canonical persisted body",
  );

  const editedMention = page.locator("[data-reef-mention]").last();
  await editedMention.waitFor({ state: "visible", timeout: 15_000 });
  const thread = editedMention
    .locator("xpath=ancestor::*[@data-testid='comment-thread']")
    .first();
  const accessibleText = await thread.ariaSnapshot();
  assert(
    accessibleText.includes(scenario.expected.visible_label),
    "comment thread accessibility snapshot omitted the mention",
  );
  return { accessibleText, mention: editedMention };
}

/** @param {unknown} raw */
function validateScenarioInput(raw) {
  assertRecord(raw, "scenario.json");
  assert(raw.schema_version === 1, "schema_version must be 1");
  if (raw.scenario === "comment-mentions") {
    return validateCommentMentionsScenario(raw);
  }
  assert(
    raw.scenario === "global-search-content",
    "scenario must be global-search-content",
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

  return /** @type {GlobalSearchScenario} */ ({
    schema_version: 1,
    scenario: "global-search-content",
    clause_id: clauseId,
    target_url: target.origin,
    workspace: text(raw.workspace, "workspace", 160),
    search_placeholder: text(raw.search_placeholder, "search_placeholder", 200),
    metadata_query: text(raw.metadata_query, "metadata_query", 500),
    content_query: text(raw.content_query, "content_query", 500),
    credentials: {
      username_env: environmentName(raw.credentials.username_env),
      password_env: environmentName(raw.credentials.password_env),
    },
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

/** @param {Record<string, unknown>} raw @returns {CommentMentionsScenario} */
function validateCommentMentionsScenario(raw) {
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
  return /** @type {CommentMentionsScenario} */ ({
    schema_version: 1,
    scenario: "comment-mentions",
    clause_id: clauseId,
    target_url: target.origin,
    workspace: text(raw.workspace, "workspace", 160),
    issue_id: text(raw.issue_id, "issue_id", 120),
    composer_label: text(raw.composer_label, "composer_label", 200),
    trigger: text(raw.trigger, "trigger", 500),
    submit_label: text(raw.submit_label, "submit_label", 200),
    edit_label: text(raw.edit_label, "edit_label", 200),
    edit_draft_label: text(raw.edit_draft_label, "edit_draft_label", 200),
    edit_submit_label: text(raw.edit_submit_label, "edit_submit_label", 200),
    credentials: {
      username_env: environmentName(raw.credentials.username_env),
      password_env: environmentName(raw.credentials.password_env),
    },
    expected: {
      option_label: text(raw.expected.option_label, "option_label", 500),
      token: text(raw.expected.token, "token", 500),
      body: text(raw.expected.body, "body", 1_000),
      canonical_body: text(
        raw.expected.canonical_body,
        "canonical_body",
        1_000,
      ),
      visible_label: text(raw.expected.visible_label, "visible_label", 500),
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

    const workspace = `/workspace/${encodeURIComponent(scenario.workspace)}/issues`;
    await page.goto(new URL(workspace, scenario.target_url).toString(), {
      waitUntil: "domcontentloaded",
    });
    transcript.push({
      event: "workspace.opened",
      workspace: scenario.workspace,
    });
    if (scenario.scenario === "comment-mentions") {
      await page.goto(
        new URL(
          `${workspace}/${encodeURIComponent(scenario.issue_id)}`,
          scenario.target_url,
        ).toString(),
        { waitUntil: "domcontentloaded" },
      );
      transcript.push({ event: "issue.opened", issue_id: scenario.issue_id });
    }
    phase = "behavior";
    const observation =
      scenario.scenario === "comment-mentions"
        ? await observeCommentMentions(page, scenario)
        : await observeGlobalSearchContent(page, scenario);
    transcript.push({
      event:
        scenario.scenario === "comment-mentions"
          ? "comment-mentions.observed"
          : "global-search.observed",
      ...(scenario.scenario === "comment-mentions"
        ? { token: scenario.expected.token }
        : {
            issue_id: scenario.expected.issue_id,
            source: scenario.expected.source,
          }),
    });

    phase = "evidence";
    const evidenceName =
      scenario.scenario === "comment-mentions"
        ? "comment-mentions"
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
    await context.close();
    status = "pass";
    observable =
      scenario.scenario === "comment-mentions"
        ? "Signed in, selected the exact-case vault-roster mention, saved the comment, and observed the non-clickable rendered mention."
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
  observeCommentMentions,
  observeGlobalSearchContent,
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
