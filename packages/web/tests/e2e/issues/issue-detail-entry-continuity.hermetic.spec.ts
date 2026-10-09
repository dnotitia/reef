import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
  type TestInfo,
} from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  REEF_E2E_VAULT,
  clearPersistedQueryCache,
  continueToWorkspace,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  setIssueReadControl,
  setAuthControl,
  signInAsAlice,
  signInAsUser,
  fixtureReaderLogin,
} from "../harness/fixture";

test.use({ video: "on" });

interface DetailFrame {
  time: number;
  url: string;
  panelOnscreen: boolean;
  panelCount: number;
  dialogCount: number;
  closeButtonVisible: boolean;
  panel: { x: number; y: number; width: number; height: number } | null;
  chrome: { x: number; y: number; width: number; height: number } | null;
}

type DetailFrameWindow = Window & { __reefDetailFrames?: DetailFrame[] };

async function newVideoContext(
  browser: Browser,
  testInfo: TestInfo,
): Promise<BrowserContext> {
  await mkdir(testInfo.outputDir, { recursive: true });
  return browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: testInfo.outputDir,
      size: { width: 1440, height: 900 },
    },
  });
}

async function closeAndAttachVideo(
  context: BrowserContext,
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  const video = page.video();
  await context.close();
  if (!video) return;
  await testInfo.attach(`${label}-video`, {
    path: await video.path(),
    contentType: "video/webm",
  });
}

async function hasPersistedDetailQuery(
  page: Page,
  vault: string,
  issueId: string,
): Promise<boolean> {
  return page.evaluate(
    ({ vaultName, id }) => {
      const raw = window.localStorage.getItem("REACT_QUERY_OFFLINE_CACHE");
      if (!raw) return false;
      try {
        const persisted = JSON.parse(raw) as {
          clientState?: { queries?: Array<{ queryKey?: unknown }> };
        };
        return (
          persisted.clientState?.queries?.some(
            ({ queryKey }) =>
              JSON.stringify(queryKey) ===
              JSON.stringify(["issues", "detail", vaultName, id]),
          ) ?? false
        );
      } catch {
        return false;
      }
    },
    { vaultName: vault, id: issueId },
  );
}

function createResponseGate() {
  let signalResponse!: (status: number) => void;
  let releaseResponse!: () => void;
  const responseReady = new Promise<number>((resolve) => {
    signalResponse = resolve;
  });
  const releaseWait = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  return {
    responseReady,
    signalResponse,
    releaseWait,
    release: releaseResponse,
  };
}

async function holdIssueDetailResponse(
  page: Page,
  vault: string,
  issueId: string,
) {
  const gate = createResponseGate();
  const inFlightHandlers = new Set<Promise<void>>();
  const matcher = (url: URL) =>
    url.pathname === `/api/issues/${issueId}` &&
    url.searchParams.get("vault") === vault;
  const runHandler = async (route: Route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    gate.signalResponse(response.status());
    await gate.releaseWait;
    await route.fulfill({ response });
  };
  const handler = (route: Route) => {
    let handlerPromise: Promise<void>;
    handlerPromise = runHandler(route).finally(() => {
      inFlightHandlers.delete(handlerPromise);
    });
    inFlightHandlers.add(handlerPromise);
    return handlerPromise;
  };
  await page.route(matcher, handler);
  return {
    ...gate,
    remove: async () => {
      gate.release();
      let handlerError: unknown;
      let hasHandlerError = false;
      try {
        while (inFlightHandlers.size > 0) {
          const results = await Promise.allSettled([...inFlightHandlers]);
          if (!hasHandlerError) {
            const rejected = results.find(
              (result) => result.status === "rejected",
            );
            if (rejected?.status === "rejected") {
              handlerError = rejected.reason;
              hasHandlerError = true;
            }
          }
        }
        if (hasHandlerError) throw handlerError;
      } finally {
        await page.unroute(matcher, handler);
      }
    },
  };
}

async function saveFrames(page: Page, info: TestInfo, label: string) {
  const frames = await page.evaluate(
    () => (window as DetailFrameWindow).__reefDetailFrames ?? [],
  );
  await mkdir(info.outputDir, { recursive: true });
  const framesPath = info.outputPath(`${label}-frames.json`);
  const screenshotPath = info.outputPath(`${label}-settled.png`);
  await writeFile(framesPath, JSON.stringify(frames, null, 2));
  await writeFile(
    screenshotPath,
    await page.screenshot({ animations: "disabled" }),
  );
  await info.attach(`${label}-frames`, {
    path: framesPath,
    contentType: "application/json",
  });
  await info.attach(`${label}-settled`, {
    path: screenshotPath,
    contentType: "image/png",
  });
  return frames;
}

function installFrameRecorder(page: Page) {
  return page.addInitScript(() => {
    const samples = [] as DetailFrame[];
    (window as DetailFrameWindow).__reefDetailFrames = samples;
    const round = (value: number) => Math.round(value * 10) / 10;
    const sample = () => {
      const panel = document.querySelector<HTMLElement>(".issue-detail-sheet");
      const panelRect = panel?.getBoundingClientRect();
      const panelStyle = panel ? getComputedStyle(panel) : null;
      const chrome = document.querySelector<HTMLElement>(
        '[data-testid="issue-detail-chrome"]',
      );
      const chromeRect = chrome?.getBoundingClientRect();
      const visiblePanel =
        !!panel &&
        !!panelRect &&
        !!panelStyle &&
        panelRect.width > 0 &&
        panelRect.height > 0 &&
        panelStyle.display !== "none" &&
        panelStyle.visibility !== "hidden" &&
        panelRect.right > 0 &&
        panelRect.left < window.innerWidth &&
        panelRect.bottom > 0 &&
        panelRect.top < window.innerHeight;
      samples.push({
        time: round(performance.now()),
        url: location.pathname,
        panelOnscreen: visiblePanel,
        panelCount: document.querySelectorAll(".issue-detail-sheet").length,
        dialogCount: document.querySelectorAll('[role="dialog"]').length,
        closeButtonVisible: !!document
          .querySelector<HTMLElement>('[data-testid="issue-close"]')
          ?.getClientRects().length,
        panel:
          panelRect && panel
            ? {
                x: round(panelRect.x),
                y: round(panelRect.y),
                width: round(panelRect.width),
                height: round(panelRect.height),
              }
            : null,
        chrome:
          chromeRect && chrome
            ? {
                x: round(chromeRect.x),
                y: round(chromeRect.y),
                width: round(chromeRect.width),
                height: round(chromeRect.height),
              }
            : null,
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function captureAndAssertContinuity(
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<DetailFrame[]> {
  await expect(page.getByTestId("issue-close")).toBeVisible();
  const frames = await saveFrames(page, testInfo, label);
  const routeFrames = frames.filter((frame) =>
    frame.url.endsWith(`/issues/REEF-101`),
  );
  expect(
    routeFrames.length,
    `${label}: no animation frames were recorded`,
  ).toBeGreaterThan(0);
  const firstPanelIndex = routeFrames.findIndex((frame) => frame.panelOnscreen);
  expect(
    firstPanelIndex,
    `${label}: the safe detail shell was never visible`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    firstPanelIndex,
    `${label}: shell appeared more than one frame after document start`,
  ).toBeLessThanOrEqual(1);
  const continuityFrames = routeFrames.slice(firstPanelIndex);
  expect(
    continuityFrames.every((frame) => frame.panelOnscreen),
    `${label}: a board-only or offscreen frame appeared`,
  ).toBe(true);
  expect(
    continuityFrames.every((frame) => frame.panelCount === 1),
    `${label}: more than one detail panel was mounted`,
  ).toBe(true);
  expect(
    continuityFrames.every((frame) => frame.dialogCount === 1),
    `${label}: more than one dialog was mounted`,
  ).toBe(true);

  const realSheetIndex = continuityFrames.findIndex(
    (frame) => frame.closeButtonVisible,
  );
  expect(
    realSheetIndex,
    `${label}: the real Sheet never became interactive`,
  ).toBeGreaterThanOrEqual(0);
  const firstPanel = continuityFrames[0]?.panel;
  const realPanel = continuityFrames[realSheetIndex]?.panel;
  const firstChrome = continuityFrames[0]?.chrome;
  const realChrome = continuityFrames[realSheetIndex]?.chrome;
  expect(firstPanel).not.toBeNull();
  expect(realPanel).not.toBeNull();
  expect(firstChrome).not.toBeNull();
  expect(realChrome).not.toBeNull();
  for (const [name, first, real] of [
    ["x", firstPanel?.x, realPanel?.x],
    ["y", firstPanel?.y, realPanel?.y],
    ["width", firstPanel?.width, realPanel?.width],
    ["height", firstPanel?.height, realPanel?.height],
    ["chrome height", firstChrome?.height, realChrome?.height],
  ] as const) {
    expect(
      Math.abs((first ?? 0) - (real ?? 0)),
      `${label}: ${name} changed across the handoff`,
    ).toBeLessThanOrEqual(1);
  }
  return routeFrames;
}

function collectHydrationWarnings(page: Page) {
  const warnings: string[] = [];
  const hydrationWarning = /hydration|did not match|server rendered html/i;
  page.on("console", (message) => {
    if (message.type() === "error" && hydrationWarning.test(message.text())) {
      warnings.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    if (hydrationWarning.test(error.message)) warnings.push(error.message);
  });
  return warnings;
}

test.describe("Hermetic issue detail hard-entry continuity", () => {
  test("keeps the same panel through three cold and three warm hard entries", async ({
    browser,
    request,
  }, testInfo) => {
    testInfo.setTimeout(300_000);
    const issuePath = `/workspace/${REEF_E2E_VAULT}/issues/REEF-101`;

    for (let iteration = 1; iteration <= 3; iteration += 1) {
      await resetFixture(request, "demo_board");
      const context = await newVideoContext(browser, testInfo);
      const page = await context.newPage();
      const hydrationWarnings = collectHydrationWarnings(page);
      try {
        // Every cold entry gets a genuinely fresh context and an authenticated
        // session created through the fixture-backed login UI.
        await signInAsAlice(page);
        await clearPersistedQueryCache(page);
        await expect
          .poll(() => hasPersistedDetailQuery(page, REEF_E2E_VAULT, "REEF-101"))
          .toBe(false);
        await installFrameRecorder(page);
        await setAuthControl(request, {
          probeDelayMs: 700,
          probeDelayOnce: true,
          session: "active",
        });
        const detailResponse = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/issues/REEF-101" &&
            response.request().method() === "GET",
        );
        await page.goto(issuePath, { waitUntil: "domcontentloaded" });
        expect((await detailResponse).status()).toBe(200);
        await expect(page.getByTestId("issue-close")).toBeVisible();
        await page.waitForTimeout(150);
        await captureAndAssertContinuity(page, testInfo, `cold-${iteration}`);
        expect(hydrationWarnings).toEqual([]);
      } finally {
        await closeAndAttachVideo(context, page, testInfo, `cold-${iteration}`);
      }
    }

    await resetFixture(request, "demo_board");
    const context = await newVideoContext(browser, testInfo);
    const page = await context.newPage();
    const hydrationWarnings = collectHydrationWarnings(page);
    try {
      await signInAsAlice(page);
      await clearPersistedQueryCache(page);
      await expect
        .poll(() => hasPersistedDetailQuery(page, REEF_E2E_VAULT, "REEF-101"))
        .toBe(false);
      await installFrameRecorder(page);

      // This one direct entry seeds the persistent detail query; the measured
      // warm runs below are all actual reloads of this same page/context.
      const seedResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/issues/REEF-101" &&
          response.request().method() === "GET",
      );
      await page.goto(issuePath, { waitUntil: "domcontentloaded" });
      expect((await seedResponse).status()).toBe(200);
      await expect(page.getByTestId("issue-title-input")).toHaveValue(
        "Review monitored-repo findings",
      );
      await expect
        .poll(() => hasPersistedDetailQuery(page, REEF_E2E_VAULT, "REEF-101"))
        .toBe(true);

      for (let iteration = 1; iteration <= 3; iteration += 1) {
        expect(
          await hasPersistedDetailQuery(page, REEF_E2E_VAULT, "REEF-101"),
          `warm-${iteration}: detail query was not persisted before reload`,
        ).toBe(true);
        const gate = await holdIssueDetailResponse(
          page,
          REEF_E2E_VAULT,
          "REEF-101",
        );
        try {
          const reload = page.reload({ waitUntil: "domcontentloaded" });
          expect(await gate.responseReady).toBe(200);
          await reload;
          // The real detail Route Handler response is held. Seeing the issue
          // here proves the page hydrated it from the persisted cache.
          await expect(page.getByTestId("issue-title-input")).toHaveValue(
            "Review monitored-repo findings",
          );
          expect(
            await hasPersistedDetailQuery(page, REEF_E2E_VAULT, "REEF-101"),
            `warm-${iteration}: detail query disappeared during reload`,
          ).toBe(true);
          await captureAndAssertContinuity(page, testInfo, `warm-${iteration}`);
          const responseDelivered = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === "/api/issues/REEF-101" &&
              response.request().method() === "GET" &&
              response.status() === 200,
          );
          gate.release();
          await responseDelivered;
        } finally {
          await gate.remove();
        }
      }
      expect(hydrationWarnings).toEqual([]);
    } finally {
      await closeAndAttachVideo(context, page, testInfo, "warm-reloads");
    }
  });

  test("keeps the frame while the original issue response and editor chunk are delayed", async ({
    context,
    page,
    request,
  }, testInfo) => {
    testInfo.setTimeout(120_000);
    await context.clearCookies();
    await page.setViewportSize({ width: 1440, height: 900 });
    const hydrationWarnings = collectHydrationWarnings(page);
    await resetFixture(request, "demo_board");
    await openExistingWorkspace(page);
    await installFrameRecorder(page);
    await clearPersistedQueryCache(page);
    await setAuthControl(request, {
      probeDelayMs: 700,
      probeDelayOnce: true,
      session: "active",
    });

    let resolveIssueHeld!: () => void;
    const issueHeld = new Promise<void>((resolve) => {
      resolveIssueHeld = resolve;
    });
    let releaseIssue!: () => void;
    const issueRelease = new Promise<void>((resolve) => {
      releaseIssue = resolve;
    });
    await page.route(
      (url) => url.pathname === "/api/issues/REEF-101",
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        resolveIssueHeld();
        await issueRelease;
        await route.fulfill({ response });
      },
    );

    let resolveEditorHeld!: () => void;
    const editorHeld = new Promise<void>((resolve) => {
      resolveEditorHeld = resolve;
    });
    let releaseEditor!: () => void;
    const editorRelease = new Promise<void>((resolve) => {
      releaseEditor = resolve;
    });
    let editorChunkIsHeld = false;
    // The loading skeleton shares the `reef-markdown-editor` CSS variable
    // prefix and can be preloaded before the issue query. Match the actual
    // editor root so this gate cannot block hydration before the detail API.
    const editorChunkMarker = /"data-testid"\s*:\s*"markdown-editor"/u;
    await page.route(
      (url) => url.pathname.includes("/_next/static/chunks/"),
      async (route) => {
        if (route.request().resourceType() !== "script") {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        const body = await response.text();
        if (!editorChunkIsHeld && editorChunkMarker.test(body)) {
          editorChunkIsHeld = true;
          resolveEditorHeld();
          await editorRelease;
        }
        await route.fulfill({ response });
      },
    );

    const issuePath = `/workspace/${REEF_E2E_VAULT}/issues/REEF-101`;
    await page.goto(issuePath, { waitUntil: "domcontentloaded" });
    await issueHeld;
    await expect(page.getByTestId("issue-detail-skeleton")).toBeVisible();
    await page.waitForTimeout(250);
    await captureAndAssertContinuity(page, testInfo, "detail-response-held");

    releaseIssue();
    await editorHeld;
    await expect(page.getByTestId("markdown-editor-skeleton")).toBeVisible();
    await page.waitForTimeout(250);
    await captureAndAssertContinuity(page, testInfo, "editor-chunk-held");

    releaseEditor();
    await expect(page.locator(".reef-markdown-editor")).toBeVisible();
    await page.waitForTimeout(150);
    await captureAndAssertContinuity(page, testInfo, "editor-ready");
    expect(hydrationWarnings).toEqual([]);
  });

  test("keeps the issue panel available for a real detail failure and retry", async ({
    context,
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await context.clearCookies();
    await resetFixture(request, "demo_board");
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);
    await expect(
      page.locator('[data-testid="issue-list-row"][data-issue-id="REEF-101"]'),
    ).toBeVisible();
    await setIssueReadControl(request, {
      issueId: "REEF-101",
      failureStatus: 503,
    });

    const issuePath = `/workspace/${REEF_E2E_VAULT}/issues/REEF-101`;
    let failedReadCount = 0;
    const countFailedReads = (
      response: import("@playwright/test").Response,
    ) => {
      if (
        new URL(response.url()).pathname === "/api/issues/REEF-101" &&
        response.request().method() === "GET" &&
        response.status() >= 500
      ) {
        failedReadCount += 1;
      }
    };
    page.on("response", countFailedReads);
    await page
      .getByText("Review monitored-repo findings", { exact: true })
      .click();
    await expect(page).toHaveURL((url) => url.pathname === issuePath);
    await expect.poll(() => failedReadCount).toBe(4);
    await expect(page.getByTestId("issue-detail-error")).toBeVisible();
    await expect(page.getByTestId("issue-close")).toBeVisible();
    await expect(page.getByTestId("issue-detail")).toHaveCount(0);
    await expect(page.getByTestId("issue-title-input")).toHaveCount(0);
    await setIssueReadControl(request, {
      issueId: "REEF-101",
      failureStatus: null,
    });

    const recoveredRead = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/issues/REEF-101" &&
        response.request().method() === "GET" &&
        response.status() === 200,
    );
    await page
      .getByTestId("issue-detail-error")
      .getByRole("button", { name: "Retry" })
      .click();
    await recoveredRead;
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await expect(page.getByTestId("issue-title-input")).toHaveValue(
      "Review monitored-repo findings",
    );
    await expect(page.getByTestId("issue-close")).toBeVisible();
    await expect(page).toHaveURL((url) => url.pathname === issuePath);
    page.off("response", countFailedReads);
  });

  test("keeps an unknown issue inside the panel error state", async ({
    context,
    page,
    request,
  }) => {
    await context.clearCookies();
    await resetFixture(request, "demo_board");
    await openExistingWorkspace(page);

    const missingPath = `/workspace/${REEF_E2E_VAULT}/issues/REEF-999`;
    const missingRead = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/issues/REEF-999" &&
        response.request().method() === "GET",
    );
    await page.goto(missingPath, { waitUntil: "domcontentloaded" });
    expect((await missingRead).status()).toBe(404);
    await expect(page.getByTestId("issue-detail-error")).toBeVisible();
    await expect(page.getByTestId("issue-close")).toBeVisible();
    await expect(page.getByTestId("issue-detail")).toHaveCount(0);
    await expect(page.getByTestId("issue-title-input")).toHaveCount(0);
    await expect(page.getByTestId("issue-detail-error")).toContainText(
      "Issue not found",
    );
  });

  test("hides the previous issue data while a different account loads it", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await resetFixture(request, "demo_board");
    await openExistingWorkspace(page);
    const issuePath = `/workspace/${REEF_E2E_VAULT}/issues/REEF-101`;
    await page.goto(issuePath, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("issue-title-input")).toHaveValue(
      "Review monitored-repo findings",
    );

    const aliceOnlyTitle = "Alice session issue title";
    await page.getByTestId("issue-title-input").fill(aliceOnlyTitle);
    await page.getByTestId("issue-title-input").press("Enter");
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults
          .find((vault) => vault.name === REEF_E2E_VAULT)
          ?.issues.find((issue) => issue.id === "REEF-101")?.title;
      })
      .toBe(aliceOnlyTitle);

    await page.getByTestId("issue-close").click();
    await expect(page).toHaveURL(
      new RegExp(`/workspace/${REEF_E2E_VAULT}/issues/?$`),
    );
    await page.getByLabel("Account menu").click();
    await page.getByTestId("account-signout").click();
    await page.waitForURL(/\/login(?:\?|$)/, { timeout: 10_000 });
    await expect
      .poll(() => hasPersistedDetailQuery(page, REEF_E2E_VAULT, "REEF-101"))
      .toBe(false);

    await resetFixture(request, "demo_board");
    await signInAsUser(page, fixtureReaderLogin);
    expect(
      await hasPersistedDetailQuery(page, REEF_E2E_VAULT, "REEF-101"),
    ).toBe(false);

    const gate = await holdIssueDetailResponse(
      page,
      REEF_E2E_VAULT,
      "REEF-101",
    );
    try {
      const loadDetail = page.goto(issuePath, {
        waitUntil: "domcontentloaded",
      });
      expect(await gate.responseReady).toBe(200);
      await loadDetail;
      await expect(page.getByTestId("issue-detail-skeleton")).toBeVisible();
      await expect(page.getByTestId("issue-title-input")).toHaveCount(0);
      await expect(page.getByText(aliceOnlyTitle, { exact: true })).toHaveCount(
        0,
      );

      const responseDelivered = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/issues/REEF-101" &&
          response.request().method() === "GET" &&
          response.status() === 200,
      );
      gate.release();
      await responseDelivered;
      await expect(page.getByTestId("issue-title-input")).toHaveValue(
        "Review monitored-repo findings",
      );
      await expect(page.getByText(aliceOnlyTitle, { exact: true })).toHaveCount(
        0,
      );
    } finally {
      gate.release();
      await gate.remove();
    }
  });

  test("hides the previous issue data while switching vaults", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await resetFixture(request, "configured_multi");
    await signInAsAlice(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues`);
    await continueToWorkspace(page, REEF_E2E_VAULT);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues/REEF-001`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("issue-title-input")).toHaveValue(
      "Initial issue Alpha",
    );

    const sourceOnlyTitle = "reef-e2e private issue title";
    await page.getByTestId("issue-title-input").fill(sourceOnlyTitle);
    await page.getByTestId("issue-title-input").press("Enter");
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults
          .find((vault) => vault.name === REEF_E2E_VAULT)
          ?.issues.find((issue) => issue.id === "REEF-001")?.title;
      })
      .toBe(sourceOnlyTitle);
    await expect
      .poll(() => hasPersistedDetailQuery(page, REEF_E2E_VAULT, "REEF-001"))
      .toBe(true);
    await page.getByTestId("issue-close").click();
    await expect(page).toHaveURL(
      new RegExp(`/workspace/${REEF_E2E_VAULT}/issues/?$`),
    );

    await page.getByTestId("sidebar-workspace-trigger").click();
    await page.getByTestId("workspace-switcher-option-reef-zeta").click();
    await expect(page).toHaveURL(/\/workspace\/reef-zeta\/issues(?:\?|$)/);
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await expect(
      page.getByText("Initial issue Alpha", { exact: true }),
    ).toBeVisible();

    const gate = await holdIssueDetailResponse(page, "reef-zeta", "REEF-001");
    try {
      await page.getByText("Initial issue Alpha", { exact: true }).click();
      await expect(page).toHaveURL(/\/workspace\/reef-zeta\/issues\/REEF-001/);
      expect(await gate.responseReady).toBe(200);
      await expect(page.getByTestId("issue-detail-skeleton")).toBeVisible();
      await expect(page.getByTestId("issue-title-input")).toHaveCount(0);
      await expect(
        page.getByText(sourceOnlyTitle, { exact: true }),
      ).toHaveCount(0);

      const responseDelivered = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/issues/REEF-001" &&
          new URL(response.url()).searchParams.get("vault") === "reef-zeta" &&
          response.request().method() === "GET" &&
          response.status() === 200,
      );
      gate.release();
      await responseDelivered;
      await expect(page.getByTestId("issue-title-input")).toHaveValue(
        "Initial issue Alpha",
      );
      await expect(
        page.getByText(sourceOnlyTitle, { exact: true }),
      ).toHaveCount(0);
    } finally {
      gate.release();
      await gate.remove();
    }
  });
});
