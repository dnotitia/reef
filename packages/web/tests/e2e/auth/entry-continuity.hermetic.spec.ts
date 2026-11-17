import { expect, type Page, type TestInfo } from "@playwright/test";
import { test } from "../harness/workspace-fixture";
import {
  openExistingWorkspace,
  readFixtureState,
  releaseAuthProbe,
  releaseResponseHold,
  setAuthControl,
  setResponseHold,
  setVaultListControl,
  signInThroughApi,
  waitForPasswordLogin,
  waitForResponseHoldPending,
} from "../harness/fixture";

async function submitLogin(page: Page, password = "password") {
  await page.getByTestId("login-username").fill("alice");
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

async function captureFrame(page: Page, testInfo: TestInfo, phase: string) {
  const frame = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing frame element ${selector}`);
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      header: rect('[data-slot="page-header"]'),
      search: rect('[data-testid="search-bar"]'),
      filters: rect('[data-testid="filter-bar"]'),
      board: rect(
        '[data-testid="board-columns-skeleton"], [data-testid="kanban-board-body"]',
      ),
    };
  });
  await testInfo.attach(`${phase}-geometry`, {
    body: JSON.stringify(frame, null, 2),
    contentType: "application/json",
  });
  await testInfo.attach(`${phase}-screen`, {
    body: await page.screenshot({ animations: "disabled" }),
    contentType: "image/png",
  });
  return frame;
}

function recordEntryFrames(page: Page) {
  return page.evaluate(
    () =>
      new Promise<
        Array<{
          form: boolean;
          feedback: boolean;
          shell: boolean;
          ready: boolean;
        }>
      >((resolve) => {
        const frames: Array<{
          form: boolean;
          feedback: boolean;
          shell: boolean;
          ready: boolean;
        }> = [];
        let started = false;
        function sample() {
          const submit = document.querySelector<HTMLButtonElement>(
            '[data-testid="login-submit"]',
          );
          started ||= submit?.disabled === true;
          const frame = {
            form: Boolean(submit),
            feedback:
              submit?.disabled === true &&
              Boolean(
                document.querySelector('[data-testid="login-submit-spinner"]'),
              ),
            shell: Boolean(
              document.querySelector('[data-testid="app-shell-skeleton"]'),
            ),
            ready: Boolean(
              document.querySelector('[data-interaction-ready="true"]'),
            ),
          };
          if (started) frames.push(frame);
          if (started && frame.ready) resolve(frames);
          else requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      }),
  );
}

test("keeps login feedback until navigation replaces the form", async ({
  page,
}, testInfo) => {
  await page.goto("/login");
  await waitForPasswordLogin(page);
  const navigationStarted = Promise.withResolvers<void>();
  const releaseNavigation = Promise.withResolvers<void>();
  await page.route(
    (url) => url.pathname === "/",
    async (route) => {
      navigationStarted.resolve();
      await releaseNavigation.promise;
      await route.continue();
    },
  );
  const framesPromise = recordEntryFrames(page);
  try {
    const response = page.waitForResponse("**/api/auth/akb/login");
    await submitLogin(page);
    expect((await response).status()).toBe(200);
    await navigationStarted.promise;
    await expect(page.getByTestId("login-submit")).toBeDisabled();
    await expect(page.getByTestId("login-submit-spinner")).toBeVisible();
    await expect(page.getByTestId("login-username")).toBeDisabled();
    await expect(page.getByTestId("login-password")).toBeDisabled();
  } finally {
    releaseNavigation.resolve();
  }
  await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues$/);
  await expect(page.getByTestId("kanban-board")).toBeVisible();
  const frames = await framesPromise;
  await testInfo.attach("entry-frames", {
    body: JSON.stringify(frames),
    contentType: "application/json",
  });
  expect(frames.length).toBeGreaterThan(1);
  expect(frames.filter((frame) => frame.form && !frame.feedback)).toEqual([]);
  expect(
    frames.filter((frame) => !frame.feedback && !frame.shell && !frame.ready),
  ).toEqual([]);
});

test.extend({ scenario: "sprint_rollover" })(
  "keeps the kanban frame through root auth, workspace resolution and data loading",
  async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/login");
    await waitForPasswordLogin(page);
    await setAuthControl(request, { probeHold: true });
    await setVaultListControl(request, { hold: true });
    await setResponseHold(request, "planning-catalog", true);
    await setResponseHold(request, "issue-list", true);
    await submitLogin(page);
    await expect(page.getByTestId("app-shell-skeleton")).toBeVisible();
    const authPending = await captureFrame(page, testInfo, "root-auth");
    await expect(page.getByTestId("new-issue-trigger")).toBeDisabled();
    await expect(page.getByTestId("sidebar-nav-issues")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.getByRole("status")).toHaveText("Loading…");
    await expect(page.getByTestId("kanban-card")).toHaveCount(0);

    await expect
      .poll(async () => (await readFixtureState(request)).auth_probe_pending)
      .toBeGreaterThan(0);
    const vaultListStarted = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/api/vaults",
    );
    await releaseAuthProbe(request);
    await vaultListStarted;
    const workspacePending = await captureFrame(
      page,
      testInfo,
      "root-workspace",
    );
    await setVaultListControl(request, { hold: false });
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues$/);
    await waitForResponseHoldPending(request, "planning-catalog");
    await waitForResponseHoldPending(request, "issue-list");
    const routePending = await captureFrame(page, testInfo, "destination-data");
    await releaseResponseHold(request, "planning-catalog");
    await expect(page.getByTestId("current-sprint-shortcut")).toBeVisible();
    const issuesPending = await captureFrame(page, testInfo, "issues-data");
    await releaseResponseHold(request, "issue-list");
    await expect(page.getByTestId("sprint-rollover-nudge")).toBeVisible();
    await expect(page.getByTestId("kanban-card").first()).toBeVisible();
    const ready = await captureFrame(page, testInfo, "ready");

    for (const frame of [
      workspacePending,
      routePending,
      issuesPending,
      ready,
    ]) {
      for (const key of ["header", "search", "filters", "board"] as const) {
        expect(Math.abs(frame[key].y - authPending[key].y)).toBeLessThanOrEqual(
          1,
        );
        expect(Math.abs(frame[key].x - authPending[key].x)).toBeLessThanOrEqual(
          1,
        );
        expect(
          Math.abs(frame[key].width - authPending[key].width),
        ).toBeLessThanOrEqual(1);
      }
    }
    await page.getByTestId("new-issue-trigger").click();
    await expect(page.getByTestId("new-issue-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("new-issue-dialog")).toHaveCount(0);
    await page.getByTestId("sidebar-nav-planning").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/planning$/);
  },
);

test("restores the filtered destination after session expiry and a failed login", async ({
  page,
  request,
}) => {
  const destination =
    "/workspace/reef-e2e/issues?view=board&priority=high&sort=updated_at&order=desc";
  await openExistingWorkspace(page);
  await page.goto(destination);
  await expect(page.getByTestId("kanban-board")).toBeVisible();
  await setAuthControl(request, { session: "revoked" });
  await page.reload();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/login" &&
      url.searchParams.get("redirect") === destination,
  );
  await waitForPasswordLogin(page);
  await submitLogin(page, "wrong-password");
  await expect(
    page.getByTestId("akb-login-form").getByRole("alert"),
  ).toContainText("Invalid username or password.");
  await expect(page.getByTestId("login-submit")).toBeEnabled();
  await expect(page.getByTestId("login-password")).toBeFocused();
  await expect(page.getByTestId("login-username")).toHaveValue("alice");
  await page.getByTestId("login-password").fill("password");
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(destination);
  await expect(page.getByTestId("kanban-board")).toBeVisible();
  await page.getByTestId("search-input").focus();
  await expect(page.getByTestId("search-input")).toBeFocused();
});

test.extend({ scenario: "sprint_rollover" })(
  "keeps the kanban frame while board code loads and then data resolves",
  async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signInThroughApi(page);
    await setResponseHold(request, "issue-list", true);
    await page.goto("/workspace/reef-e2e/issues?view=list");
    await expect(page.getByTestId("view-switcher-board")).toBeEnabled();
    const chunkStarted = Promise.withResolvers<void>();
    const releaseChunk = Promise.withResolvers<void>();
    await page.route("**/_next/static/chunks/*.js", async (route) => {
      chunkStarted.resolve();
      await releaseChunk.promise;
      await route.continue();
    });
    try {
      await page.getByTestId("view-switcher-board").click();
      await chunkStarted.promise;
      await expect(page.getByTestId("issues-board-loading")).toBeVisible();
      const codePending = await captureFrame(page, testInfo, "board-code");
      releaseChunk.resolve();
      await expect(page.getByTestId("issues-board-loading")).toHaveCount(0);
      await expect(page.getByTestId("board-columns-skeleton")).toBeVisible();
      const dataPending = await captureFrame(page, testInfo, "board-data");
      await releaseResponseHold(request, "issue-list");
      await expect(page.getByTestId("kanban-board")).toBeVisible();
      const ready = await captureFrame(page, testInfo, "board-code-ready");
      expect(dataPending.header).toEqual(codePending.header);
      expect(dataPending.search).toEqual(codePending.search);
      expect(dataPending.filters).toEqual(codePending.filters);
      expect(dataPending.board).toEqual(codePending.board);
      expect(ready.board).toEqual(codePending.board);
    } finally {
      releaseChunk.resolve();
    }
  },
);
