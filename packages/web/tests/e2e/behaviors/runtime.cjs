/**
 * Runtime seams shared by canonical hermetic specs and the source-free
 * behavior artifact. Feature behavior stays in the sibling modules; this file
 * only owns login, fixture controls, and small assertion/error helpers.
 */

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function markClause(error, clauseId) {
  if (error && typeof error === "object") {
    error.behavior_clause = clauseId;
  }
  throw error;
}

async function runClause(clauseId, callback) {
  try {
    return await callback();
  } catch (error) {
    return markClause(error, clauseId);
  }
}

function fixtureUrl(origin, path) {
  return new URL(path, origin).toString();
}

function createFixtureControl(request, origin) {
  async function post(path, data) {
    const response = await request.post(fixtureUrl(origin, path), { data });
    assert(
      response.ok(),
      `fixture request failed: ${path} (${response.status()})`,
    );
    return response;
  }

  return {
    reset: async (scenario) => {
      const response = await post("/__e2e/reset", { scenario });
      const body = await response.json();
      assert(
        body?.ok === true && body.scenario === scenario,
        `fixture reset returned an unexpected scenario for ${scenario}`,
      );
    },
    setIssueListFailure: async (enabled, nextPageFailures = 0) => {
      await post("/__e2e/issue-list-failure", {
        enabled,
        next_page_failures: nextPageFailures,
      });
    },
    readState: async () => {
      const response = await request.get(fixtureUrl(origin, "/__e2e/state"));
      assert(
        response.ok(),
        `fixture state request failed (${response.status()})`,
      );
      return response.json();
    },
  };
}

async function clearPersistedQueryCacheOnLoad(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("REACT_QUERY_OFFLINE_CACHE");
    } catch {
      // A missing cache is the desired state before the application boots.
    }
  });
}

async function loginToWorkspace(
  page,
  { webOrigin, workspace, credentials, expect },
) {
  const loginUrl = new URL("/login", webOrigin);
  loginUrl.searchParams.set("password", "1");
  await page.goto(loginUrl.toString(), {
    waitUntil: "domcontentloaded",
  });
  await page.locator('[data-testid="akb-login-form"]').waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page
    .locator('[data-testid="login-username"]')
    .fill(credentials.username);
  await page
    .locator('[data-testid="login-password"]')
    .fill(credentials.password);
  const loginResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/akb/login" &&
      response.request().method() === "POST",
  );
  await page.locator('[data-testid="login-submit"]').click();
  const loginResponse = await loginResponsePromise;
  assert(loginResponse.ok(), `login returned HTTP ${loginResponse.status()}`);
  await page.waitForURL((url) => url.pathname !== "/login", {
    timeout: 15_000,
  });
  await page.goto(
    new URL(
      `/workspace/${encodeURIComponent(workspace)}/issues`,
      webOrigin,
    ).toString(),
    { waitUntil: "domcontentloaded" },
  );

  assert(typeof expect === "function", "login requires Playwright expect");

  // The workspace shell installs the global shortcut after hydration. Retry
  // the shortcut itself until it opens the palette; a single probe can be
  // lost before the listener is ready in a slower source-free browser.
  const globalSearchInput = page.locator('[data-testid="global-search-input"]');
  await expect(async () => {
    await page.keyboard.press("Control+K");
    await expect(globalSearchInput).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(globalSearchInput).toHaveCount(0);
}

function redactText(value, secrets) {
  return secrets
    .filter((secret) => typeof secret === "string" && secret.length > 0)
    .reduce((result, secret) => result.replaceAll(secret, "[REDACTED]"), value);
}

function behaviorReason(error) {
  if (typeof error?.behavior_reason === "string") {
    return error.behavior_reason;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (
    /browserType\.launch|executable doesn't exist|cannot find package.*playwright|playwright.*browser/iu.test(
      message,
    )
  ) {
    return "blocked_tooling";
  }
  if (
    /net::ERR_|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|failed to connect|target page, context or browser has been closed/iu.test(
      message,
    )
  ) {
    return "blocked_runtime";
  }
  return undefined;
}

module.exports = {
  assert,
  behaviorReason,
  clearPersistedQueryCacheOnLoad,
  createFixtureControl,
  loginToWorkspace,
  markClause,
  redactText,
  runClause,
};
