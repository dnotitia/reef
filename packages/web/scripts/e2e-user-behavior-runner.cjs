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
 * @property {string} fixture_origin
 * @property {string} workspace
 * @property {{username_env: string, password_env: string}} credentials
 * @property {{focus_issue_id: string, keyboard_steps: number, max_mounted_rows: number, min_scroll_height: number, selection_issue_ids: string[], quick_edit_issue_id: string, quick_edit_label: string, max_anchor_delta: number, sparse_filter: string, sparse_issue_id: string, sparse_issue_title: string, cls_budget: number, sibling_view: "board"}} expected
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

const LARGE_ISSUE_LIST_CLAUSES = ["B1", "B2", "B3", "B4", "B5"];

function isIssueListUrl(value) {
  const url = value instanceof URL ? value : new URL(value);
  return url.pathname === "/api/issues";
}

function issueIds(body) {
  return Array.isArray(body?.issues)
    ? body.issues
        .map((issue) => issue?.id)
        .filter((id) => typeof id === "string")
    : [];
}

function recordIssueTraffic(page) {
  const requests = [];
  const responses = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && isIssueListUrl(url)) {
      requests.push({ url: url.toString() });
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (response.request().method() !== "GET" || !isIssueListUrl(url)) {
      return;
    }
    const entry = {
      url: url.toString(),
      status: response.status(),
      ok: response.ok(),
      ids: [],
    };
    responses.push(entry);
    if (response.ok()) {
      response
        .json()
        .then((body) => {
          entry.ids = issueIds(body);
        })
        .catch(() => undefined);
    }
  });
  return { requests, responses };
}

function requestEvidence(traffic) {
  const summarize = (raw) => {
    const url = new URL(raw.url);
    return {
      url: `${url.pathname}${url.search}`,
      path: url.pathname,
      limit: url.searchParams.get("limit"),
      has_cursor: url.searchParams.has("cursor"),
    };
  };
  return {
    requests: traffic.requests.map(summarize),
    responses: traffic.responses.map((entry) => ({
      ...summarize(entry),
      status: entry.status,
      ok: entry.ok,
      ids: entry.ids,
    })),
  };
}

async function readIssueResponse(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("issue list response was not JSON");
  }
  return { ids: issueIds(body), body };
}

function issueResponses(traffic, cursor, ok) {
  return traffic.responses.filter((entry) => {
    const url = new URL(entry.url);
    return (
      url.searchParams.has("cursor") === cursor &&
      (ok === undefined || entry.ok === ok)
    );
  });
}

async function visibleIssueIds(page) {
  return page
    .locator('[data-testid="issue-list-row"]')
    .evaluateAll((rows) =>
      rows
        .map((row) => row.getAttribute("data-issue-id"))
        .filter((id) => typeof id === "string"),
    );
}

async function scrollToListEnd(page) {
  await page.getByTestId("issue-list-scroll-container").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
}

function blockedBehavior(message) {
  const error = new Error(message);
  error.behavior_status = "blocked";
  return error;
}

async function fixtureRequest(scenario, path, options = {}) {
  let response;
  try {
    response = await fetch(new URL(path, scenario.fixture_origin), options);
  } catch {
    throw blockedBehavior(`fixture request failed: ${path}`);
  }
  if (!response.ok) {
    throw blockedBehavior(
      `fixture request returned HTTP ${response.status}: ${path}`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw blockedBehavior(`fixture response was not JSON: ${path}`);
  }
}

async function resetLargeVault(scenario) {
  await fixtureRequest(scenario, "/__e2e/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario: "large_vault" }),
  });
}

async function controlIssueListFailure(scenario, nextPageFailures) {
  await fixtureRequest(scenario, "/__e2e/issue-list-failure", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      enabled: false,
      next_page_failures: nextPageFailures,
    }),
  });
}

async function readFixtureState(scenario) {
  return fixtureRequest(scenario, "/__e2e/state");
}

async function loginToTarget(
  page,
  scenario,
  credentials,
  transcript,
  clauseId,
) {
  transcript.push({ event: "login.opened", clause_id: clauseId });
  await page.goto(new URL("/login", scenario.target_url).toString(), {
    waitUntil: "domcontentloaded",
  });
  await page
    .locator('[data-testid="akb-login-form"]')
    .waitFor({ state: "visible", timeout: 20_000 });
  await page
    .locator('[data-testid="login-username"]')
    .fill(credentials.username);
  await page
    .locator('[data-testid="login-password"]')
    .fill(credentials.password);
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
    clause_id: clauseId,
    status: loginResponse.status(),
  });
}

async function openLargeListCase(
  browser,
  scenario,
  credentials,
  transcript,
  clauseId,
  query,
  beforeGoto = undefined,
) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await loginToTarget(page, scenario, credentials, transcript, clauseId);
  const traffic = recordIssueTraffic(page);
  if (beforeGoto) await beforeGoto(page);
  const firstResponsePromise = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        response.request().method() === "GET" &&
        isIssueListUrl(url) &&
        !url.searchParams.has("cursor") &&
        url.searchParams.get("limit") === "100"
      );
    },
    { timeout: 20_000 },
  );
  const querySuffix = query ? `&${query}` : "";
  const workspace = `/workspace/${encodeURIComponent(scenario.workspace)}/issues?view=list${querySuffix}`;
  await page.goto(new URL(workspace, scenario.target_url).toString(), {
    waitUntil: "domcontentloaded",
  });
  await page
    .locator('[data-testid="issue-list-row"]')
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
  await page.locator('[data-interaction-ready="true"]').waitFor({
    state: "attached",
    timeout: 20_000,
  });
  const firstResponse = await firstResponsePromise;
  const firstPage = await readIssueResponse(firstResponse);
  return { context, page, traffic, firstPage };
}

async function saveClauseEvidence(outputDir, stem, page, accessibleText, data) {
  const screenshot = `${stem}.png`;
  const aria = `${stem}.aria.txt`;
  const details = `${stem}.json`;
  await page.screenshot({ path: join(outputDir, screenshot), fullPage: false });
  await chmod(join(outputDir, screenshot), 0o600);
  await writePrivate(join(outputDir, aria), `${accessibleText ?? ""}\n`);
  await writePrivate(
    join(outputDir, details),
    `${JSON.stringify(data, null, 2)}\n`,
  );
  return [screenshot, aria, details];
}

async function observeLargeIssueListB1(
  browser,
  scenario,
  credentials,
  outputDir,
  transcript,
) {
  await resetLargeVault(scenario);
  const run = await openLargeListCase(
    browser,
    scenario,
    credentials,
    transcript,
    "B1",
    "",
  );
  try {
    const { page, firstPage, traffic } = run;
    assert(
      firstPage.ids.length <= 100,
      `initial page returned ${firstPage.ids.length} issues`,
    );
    const rows = page.locator('[data-testid="issue-list-row"]');
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
    const beforeTailIds = (await visibleIssueIds(page)).slice(-5);
    const cursorResponsePromise = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          response.ok() &&
          response.request().method() === "GET" &&
          isIssueListUrl(url) &&
          url.searchParams.has("cursor")
        );
      },
      { timeout: 20_000 },
    );
    await scrollToListEnd(page);
    const cursorResponse = await cursorResponsePromise;
    const cursorPage = await readIssueResponse(cursorResponse);
    await page.waitForTimeout(300);
    const cursorRequests = traffic.requests.filter(({ url }) =>
      new URL(url).searchParams.has("cursor"),
    );
    assert(
      cursorRequests.length === 1,
      `expected one cursor request, observed ${cursorRequests.length}`,
    );
    assert(cursorPage.ids.length > 0, "cursor page returned no issues");
    assert(
      cursorPage.ids.every((id) => !firstPage.ids.includes(id)),
      "cursor page repeats an issue from the initial page",
    );
    const afterTailIds = (await visibleIssueIds(page)).slice(-5);
    assert(
      afterTailIds.some((id) => !beforeTailIds.includes(id)),
      "visible issue tail did not change after cursor request",
    );
    const mountedIds = await visibleIssueIds(page);
    assert(
      new Set(mountedIds).size === mountedIds.length,
      "mounted issue rows contain duplicate ids",
    );
    const evidence = await saveClauseEvidence(
      outputDir,
      "large-issue-list.B1",
      page,
      await rows.first().ariaSnapshot(),
      {
        first_page_count: firstPage.ids.length,
        initial_row_count: initialRowCount,
        max_mounted_rows: scenario.expected.max_mounted_rows,
        client_height: range.clientHeight,
        scroll_height: range.scrollHeight,
        before_visible_tail_ids: beforeTailIds,
        after_visible_tail_ids: afterTailIds,
        cursor_page_ids: cursorPage.ids,
        mounted_row_count: mountedIds.length,
        request_summary: requestEvidence(traffic),
      },
    );
    return {
      observable: `Initial limit=100, ${initialRowCount} mounted rows, ${range.scrollHeight}px scroll range, and one duplicate-free cursor continuation were observed.`,
      evidence,
    };
  } finally {
    await run.context.close().catch(() => undefined);
  }
}

async function observeLargeIssueListB2(
  browser,
  scenario,
  credentials,
  outputDir,
  transcript,
) {
  await resetLargeVault(scenario);
  await controlIssueListFailure(scenario, 1);
  const failureRun = await openLargeListCase(
    browser,
    scenario,
    credentials,
    transcript,
    "B2-failure",
    "",
  );
  let failureResult;
  try {
    const { page, firstPage, traffic } = failureRun;
    const rows = page.locator('[data-testid="issue-list-row"]');
    const beforeFailureIds = await visibleIssueIds(page);
    const failedResponsePromise = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          !response.ok() &&
          response.request().method() === "GET" &&
          isIssueListUrl(url) &&
          url.searchParams.has("cursor")
        );
      },
      { timeout: 20_000 },
    );
    await scrollToListEnd(page);
    await failedResponsePromise;
    await page
      .getByText("More issues could not be loaded.", { exact: true })
      .waitFor({ state: "visible", timeout: 15_000 });
    const afterFailureIds = await visibleIssueIds(page);
    assert(
      afterFailureIds.length > 0,
      "loaded rows disappeared after page failure",
    );
    assert(
      afterFailureIds.every((id) => firstPage.ids.includes(id)),
      "a failed next-page request rendered an issue outside the loaded first page",
    );
    const retryResponsePromise = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          response.ok() &&
          response.request().method() === "GET" &&
          isIssueListUrl(url) &&
          url.searchParams.has("cursor")
        );
      },
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    const retryResponse = await retryResponsePromise;
    const retryPage = await readIssueResponse(retryResponse);
    await page.waitForTimeout(300);
    const cursorRequests = traffic.requests.filter(({ url }) =>
      new URL(url).searchParams.has("cursor"),
    );
    assert(
      cursorRequests.length === 2,
      `expected one failed and one retried cursor request, observed ${cursorRequests.length}`,
    );
    assert(
      issueResponses(traffic, true, false).length === 1 &&
        issueResponses(traffic, true, true).length === 1,
      "next-page failure/retry response sequence was not exactly one failure plus one success",
    );
    assert(
      retryPage.ids.every((id) => !firstPage.ids.includes(id)),
      "retried cursor page repeats an issue from the first page",
    );
    failureResult = {
      before_failure_ids: beforeFailureIds,
      after_failure_ids: afterFailureIds,
      retried_page_ids: retryPage.ids,
      request_summary: requestEvidence(traffic),
      row_count_after_failure: await rows.count(),
    };
  } finally {
    await failureRun.context.close().catch(() => undefined);
  }

  await resetLargeVault(scenario);
  const sparseRun = await openLargeListCase(
    browser,
    scenario,
    credentials,
    transcript,
    "B2-sparse",
    "",
  );
  try {
    const { page, traffic } = sparseRun;
    const filter = page.getByTestId("labels-input");
    await filter.waitFor({ state: "visible", timeout: 15_000 });
    await filter.fill(scenario.expected.sparse_filter);
    await filter.press("Enter");
    await page
      .getByText(scenario.expected.sparse_issue_title, { exact: true })
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(500);
    const successfulPages = traffic.responses.filter((entry) => entry.ok);
    const firstPage = successfulPages.find((entry) => {
      const url = new URL(entry.url);
      return (
        !url.searchParams.has("cursor") &&
        url.searchParams.get("limit") === "100"
      );
    });
    assert(firstPage, "sparse filter first page response was not observed");
    assert(
      !firstPage.ids.includes(scenario.expected.sparse_issue_id),
      "sparse match was present on the first page",
    );
    const matchingCursor = successfulPages.find(
      (entry) =>
        new URL(entry.url).searchParams.has("cursor") &&
        entry.ids.includes(scenario.expected.sparse_issue_id),
    );
    assert(
      matchingCursor,
      "sparse residual match did not arrive on a later page",
    );
    const evidence = await saveClauseEvidence(
      outputDir,
      "large-issue-list.B2",
      page,
      await page
        .getByText(scenario.expected.sparse_issue_title, { exact: true })
        .ariaSnapshot(),
      {
        failure_retry: failureResult,
        sparse_filter: scenario.expected.sparse_filter,
        sparse_issue_id: scenario.expected.sparse_issue_id,
        sparse_first_page_ids: firstPage.ids,
        sparse_matching_cursor_page_ids: matchingCursor.ids,
        request_summary: requestEvidence(traffic),
      },
    );
    return {
      observable:
        "A failed next-page request retained loaded rows, Retry appended once, and a later sparse residual match appeared after a first page without that id.",
      evidence,
    };
  } finally {
    await sparseRun.context.close().catch(() => undefined);
  }
}

async function observeLargeIssueListB3(
  browser,
  scenario,
  credentials,
  outputDir,
  transcript,
) {
  await resetLargeVault(scenario);
  const run = await openLargeListCase(
    browser,
    scenario,
    credentials,
    transcript,
    "B3",
    "",
  );
  try {
    const { page } = run;
    const target = page.locator(
      `[data-issue-id="${scenario.expected.focus_issue_id}"]`,
    );
    const initialTargetCount = await target.count();
    assert(
      initialTargetCount === 0,
      "keyboard target was mounted before navigation",
    );
    await page.locator('[data-testid="issue-list-row"]').first().focus();
    for (let index = 0; index < scenario.expected.keyboard_steps; index += 1) {
      await page.keyboard.press("j");
    }
    await target.waitFor({ state: "visible", timeout: 20_000 });
    assert(
      (await target.getAttribute("data-keyboard-focused")) === "true",
      "keyboard target did not own list focus",
    );
    assert(
      (await target.getAttribute("tabindex")) === "0",
      "keyboard target did not own the roving tab stop",
    );
    const focusedAria = await target.ariaSnapshot();
    const evidence = await saveClauseEvidence(
      outputDir,
      "large-issue-list.B3-focus",
      page,
      focusedAria,
      {
        target_issue_id: scenario.expected.focus_issue_id,
        initial_target_count: initialTargetCount,
        keyboard_steps: scenario.expected.keyboard_steps,
        keyboard_focused: await target.getAttribute("data-keyboard-focused"),
        tabindex: await target.getAttribute("tabindex"),
      },
    );
    await page.keyboard.press("Enter");
    await page.waitForURL((url) =>
      url.pathname.endsWith(`/issues/${scenario.expected.focus_issue_id}`),
    );
    await page.getByTestId("issue-detail").waitFor({
      state: "visible",
      timeout: 15_000,
    });
    const detailScreenshot = "large-issue-list.B3-detail.png";
    await page.screenshot({
      path: join(outputDir, detailScreenshot),
      fullPage: false,
    });
    await chmod(join(outputDir, detailScreenshot), 0o600);
    evidence.push(detailScreenshot);
    return {
      observable: `j navigation mounted ${scenario.expected.focus_issue_id}, gave it the roving tab stop, and Enter opened its detail.`,
      evidence,
    };
  } finally {
    await run.context.close().catch(() => undefined);
  }
}

async function observeLargeIssueListB4(
  browser,
  scenario,
  credentials,
  outputDir,
  transcript,
) {
  await resetLargeVault(scenario);
  const run = await openLargeListCase(
    browser,
    scenario,
    credentials,
    transcript,
    "B4",
    `labels=${encodeURIComponent("large-fixture")}`,
  );
  try {
    const { page } = run;
    const [firstId, secondId] = scenario.expected.selection_issue_ids;
    const first = page.locator(`[data-issue-id="${firstId}"]`);
    const second = page.locator(`[data-issue-id="${secondId}"]`);
    await page.locator('[data-testid="issue-list-row"]').first().focus();
    for (let index = 0; index < scenario.expected.keyboard_steps; index += 1) {
      await page.keyboard.press("j");
    }
    await first.waitFor({ state: "visible", timeout: 20_000 });
    await second.waitFor({ state: "visible", timeout: 20_000 });
    await first.getByTestId("issue-row-checkbox").click();
    await second
      .getByTestId("issue-row-checkbox")
      .click({ modifiers: ["Shift"] });
    const selectedIds = await page
      .locator('[data-testid="issue-list-row"][aria-selected="true"]')
      .evaluateAll((rows) =>
        rows
          .map((row) => row.getAttribute("data-issue-id"))
          .filter((id) => typeof id === "string"),
      );
    assert(
      selectedIds.length === 2 &&
        scenario.expected.selection_issue_ids.every((id) =>
          selectedIds.includes(id),
        ),
      `unexpected selected loaded ids: ${selectedIds.join(",")}`,
    );
    await page
      .getByTestId("issue-bulk-action-bar")
      .getByRole("button", { name: "Clear", exact: true })
      .click();
    await first.focus();
    const scroll = page.getByTestId("issue-list-scroll-container");
    const beforeScrollTop = await scroll.evaluate(
      (element) => element.scrollTop,
    );
    const updateResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname.endsWith(
          `/api/issues/${scenario.expected.quick_edit_issue_id}`,
        ) &&
        response.ok(),
      { timeout: 20_000 },
    );
    await page.keyboard.press("l");
    await page
      .getByTestId("issue-quick-edit-anchor")
      .getByRole("button", {
        name: `Remove label ${scenario.expected.quick_edit_label}`,
        exact: true,
      })
      .click();
    const updateResponse = await updateResponsePromise;
    await first.waitFor({ state: "detached", timeout: 20_000 });
    const afterScrollTop = await scroll.evaluate(
      (element) => element.scrollTop,
    );
    const anchorDelta = Math.abs(afterScrollTop - beforeScrollTop);
    assert(
      anchorDelta <= scenario.expected.max_anchor_delta,
      `viewport anchor moved by ${anchorDelta}px`,
    );
    const state = await readFixtureState(scenario);
    const issue = state.vaults
      ?.find((vault) => vault.name === scenario.workspace)
      ?.issues?.find(
        (candidate) => candidate.id === scenario.expected.quick_edit_issue_id,
      );
    assert(issue, "edited issue was not present in fixture state");
    assert(
      !issue.labels.includes(scenario.expected.quick_edit_label),
      "quick edit did not persist through the fixture Route Handler",
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="issue-list-row"]')
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
    assert(
      (await page
        .locator(`[data-issue-id="${scenario.expected.quick_edit_issue_id}"]`)
        .count()) === 0,
      "edited issue reappeared after refetch under the residual filter",
    );
    const evidence = await saveClauseEvidence(
      outputDir,
      "large-issue-list.B4",
      page,
      await page
        .locator('[data-testid="issue-list-row"]')
        .first()
        .ariaSnapshot(),
      {
        selected_loaded_ids: selectedIds,
        quick_edit_issue_id: scenario.expected.quick_edit_issue_id,
        update_method: updateResponse.request().method(),
        update_status: updateResponse.status(),
        before_scroll_top: beforeScrollTop,
        after_scroll_top: afterScrollTop,
        anchor_delta: anchorDelta,
        persisted_labels: issue.labels,
        absent_after_refetch: true,
      },
    );
    return {
      observable: `Shift selected only the two loaded deep rows; a real PATCH removed ${scenario.expected.quick_edit_label}, persisted it, and kept the viewport anchor within ${scenario.expected.max_anchor_delta}px.`,
      evidence,
    };
  } finally {
    await run.context.close().catch(() => undefined);
  }
}

async function observeLargeIssueListB5(
  browser,
  scenario,
  credentials,
  outputDir,
  transcript,
) {
  await resetLargeVault(scenario);
  const run = await openLargeListCase(
    browser,
    scenario,
    credentials,
    transcript,
    "B5",
    "",
    async (page) => {
      await page.addInitScript(() => {
        window.__reefBehaviorCls = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__reefBehaviorCls += entry.value;
          }
        });
        observer.observe({ type: "layout-shift", buffered: true });
        window.__reefBehaviorClsObserver = observer;
      });
    },
  );
  try {
    const { page, firstPage } = run;
    await page.waitForTimeout(300);
    const cls = await page.evaluate(() => {
      window.__reefBehaviorClsObserver?.disconnect();
      return window.__reefBehaviorCls ?? 0;
    });
    assert(
      cls < scenario.expected.cls_budget,
      `CLS ${cls} exceeded ${scenario.expected.cls_budget}`,
    );
    const boardSwitch = page.locator('[data-testid="view-switcher-board"]');
    await boardSwitch.click();
    await page.getByTestId("kanban-board").waitFor({
      state: "visible",
      timeout: 20_000,
    });
    const url = new URL(page.url());
    assert(
      url.searchParams.get("view") === scenario.expected.sibling_view,
      "finite sibling view did not activate",
    );
    const evidence = await saveClauseEvidence(
      outputDir,
      "large-issue-list.B5",
      page,
      await page.getByTestId("kanban-board").ariaSnapshot(),
      {
        cls,
        cls_budget: scenario.expected.cls_budget,
        first_page_count: firstPage.ids.length,
        sibling_view: scenario.expected.sibling_view,
        final_url: `${url.pathname}${url.search}`,
      },
    );
    return {
      observable: `Hard List navigation measured CLS ${cls} below ${scenario.expected.cls_budget} and a real switch rendered the finite ${scenario.expected.sibling_view} view.`,
      evidence,
    };
  } finally {
    await run.context.close().catch(() => undefined);
  }
}

async function runLargeIssueListScenario({
  browser,
  scenario,
  credentials,
  outputDir,
  transcript,
}) {
  const clauseFunctions = [
    ["B1", observeLargeIssueListB1],
    ["B2", observeLargeIssueListB2],
    ["B3", observeLargeIssueListB3],
    ["B4", observeLargeIssueListB4],
    ["B5", observeLargeIssueListB5],
  ];
  const clauses = [];
  for (const [id, observe] of clauseFunctions) {
    try {
      const result = await observe(
        browser,
        scenario,
        credentials,
        outputDir,
        transcript,
      );
      clauses.push({
        id,
        status: "pass",
        observable: result.observable,
        evidence: result.evidence,
      });
      transcript.push({
        event: "large-issue-list.clause.passed",
        clause_id: id,
      });
    } catch (error) {
      const message = redactText(
        error instanceof Error ? error.message : String(error),
        [credentials.username, credentials.password],
      );
      const status = error?.behavior_status === "blocked" ? "blocked" : "fail";
      clauses.push({ id, status, observable: message, evidence: [] });
      transcript.push({
        event: "large-issue-list.clause.error",
        clause_id: id,
        status,
        message,
      });
    }
  }
  return {
    status: clauses.every((clause) => clause.status === "pass")
      ? "pass"
      : clauses.some((clause) => clause.status === "fail")
        ? "fail"
        : "blocked",
    clauses,
    observable: clauses.every((clause) => clause.status === "pass")
      ? "Signed in and exercised all five List behavior clauses through the user surface."
      : "One or more List behavior clauses did not pass.",
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
    const fixture = new URL(text(raw.fixture_origin, "fixture_origin", 2048));
    assert(
      /^https?:$/u.test(fixture.protocol),
      "fixture_origin must use http or https",
    );
    assert(
      !(
        fixture.username ||
        fixture.password ||
        fixture.pathname !== "/" ||
        fixture.search ||
        fixture.hash
      ),
      "fixture_origin must be an origin without credentials, path, query, or fragment",
    );
    const keyboardSteps = Number(raw.expected.keyboard_steps);
    const maxMountedRows = Number(raw.expected.max_mounted_rows);
    const minScrollHeight = Number(raw.expected.min_scroll_height);
    const maxAnchorDelta = Number(raw.expected.max_anchor_delta);
    const clsBudget = Number(raw.expected.cls_budget);
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
    assert(
      Number.isInteger(maxAnchorDelta) && maxAnchorDelta >= 0,
      "invalid max_anchor_delta",
    );
    assert(
      Number.isFinite(clsBudget) && clsBudget > 0 && clsBudget < 1,
      "invalid cls_budget",
    );
    assert(
      Array.isArray(raw.expected.selection_issue_ids) &&
        raw.expected.selection_issue_ids.length === 2,
      "selection_issue_ids must contain two issue ids",
    );
    const selectionIssueIds = raw.expected.selection_issue_ids.map((id) =>
      text(id, "selection_issue_id", 120),
    );
    assert(raw.expected.sibling_view === "board", "sibling_view must be board");
    return /** @type {LargeIssueListScenario} */ ({
      schema_version: 1,
      scenario: "large-issue-list",
      clause_id: clauseId,
      target_url: target.origin,
      fixture_origin: fixture.origin,
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
        selection_issue_ids: selectionIssueIds,
        quick_edit_issue_id: text(
          raw.expected.quick_edit_issue_id,
          "quick_edit_issue_id",
          120,
        ),
        quick_edit_label: text(
          raw.expected.quick_edit_label,
          "quick_edit_label",
          120,
        ),
        max_anchor_delta: maxAnchorDelta,
        sparse_filter: text(raw.expected.sparse_filter, "sparse_filter", 120),
        sparse_issue_id: text(
          raw.expected.sparse_issue_id,
          "sparse_issue_id",
          120,
        ),
        sparse_issue_title: text(
          raw.expected.sparse_issue_title,
          "sparse_issue_title",
          500,
        ),
        cls_budget: clsBudget,
        sibling_view: "board",
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
  let scenario;
  let observation;

  try {
    const inputPath = resolve(options.inputDir, "scenario.json");
    const inputInfo = await lstat(inputPath);
    assert(
      inputInfo.isFile() && !inputInfo.isSymbolicLink(),
      "scenario.json must be a regular file",
    );
    scenario = validateScenarioInput(
      JSON.parse(await readFile(inputPath, "utf8")),
    );
    clauseId = scenario.clause_id;
    const username = process.env[scenario.credentials.username_env] ?? "";
    const password = process.env[scenario.credentials.password_env] ?? "";
    secrets.push(username, password);
    assert(username && password, "declared credential variables are required");

    runtime = await loadPlaywright();
    browser = await runtime.chromium.launch({ headless: true });
    phase = "behavior";
    if (scenario.scenario === "large-issue-list") {
      observation = await runLargeIssueListScenario({
        browser,
        scenario,
        credentials: { username, password },
        outputDir,
        transcript,
      });
      status = observation.status;
      observable = observation.observable;
      transcript.push({
        event: "workspace.opened",
        workspace: scenario.workspace,
        scenario: scenario.scenario,
      });
    } else {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await loginToTarget(
        page,
        scenario,
        { username, password },
        transcript,
        scenario.clause_id,
      );
      const workspace = `/workspace/${encodeURIComponent(scenario.workspace)}/issues`;
      await page.goto(new URL(workspace, scenario.target_url).toString(), {
        waitUntil: "domcontentloaded",
      });
      observation = await observeGlobalSearchContent(page, scenario);
      transcript.push({
        event: "workspace.opened",
        workspace: scenario.workspace,
      });
      transcript.push({
        event: "global-search.observed",
        issue_id: scenario.expected.issue_id,
        source: scenario.expected.source,
      });

      phase = "evidence";
      const globalEvidence = await saveClauseEvidence(
        outputDir,
        "global-search",
        page,
        observation.accessibleText,
        {
          issue_id: scenario.expected.issue_id,
          source: scenario.expected.source,
        },
      );
      evidence.push(...globalEvidence);
      await context.close().catch(() => undefined);
      status = "pass";
      observable =
        "Signed in, opened global search, and observed the configured field and content result in accessible order.";
    }
    if (scenario.scenario === "large-issue-list") {
      phase = "evidence";
    }
    if (
      scenario.scenario === "large-issue-list" &&
      observation.status === "pass"
    ) {
      status = "pass";
    }
    if (scenario.scenario === "large-issue-list") {
      observable = observation.observable;
    }
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
  const reportClauses = observation?.clauses
    ? observation.clauses.map((clause) => ({
        ...clause,
        evidence: clause.evidence.includes("redacted-transcript.jsonl")
          ? clause.evidence
          : [...clause.evidence, "redacted-transcript.jsonl"],
      }))
    : scenario?.scenario === "large-issue-list"
      ? LARGE_ISSUE_LIST_CLAUSES.map((id) => ({
          id,
          status,
          observable,
          evidence: ["redacted-transcript.jsonl"],
        }))
      : [{ id: clauseId, status, observable, evidence }];
  await writePrivate(
    join(outputDir, "behavior-report.json"),
    `${JSON.stringify(
      {
        candidate_head: options.candidateHead,
        status,
        clauses: reportClauses,
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
  LARGE_ISSUE_LIST_CLAUSES,
  observeGlobalSearchContent,
  packRunnerArtifact,
  redactText,
  runLargeIssueListScenario,
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
