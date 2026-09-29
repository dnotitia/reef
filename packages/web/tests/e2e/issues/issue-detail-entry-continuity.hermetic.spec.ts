import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  REEF_E2E_VAULT,
  clearPersistedQueryCache,
  openExistingWorkspace,
  resetFixture,
  setAuthControl,
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

test.describe("Hermetic issue detail hard-entry continuity (REEF-648)", () => {
  test("keeps the same panel through three cold and three warm hard entries", async ({
    context,
    page,
    request,
  }, testInfo) => {
    testInfo.setTimeout(180_000);
    await context.clearCookies();
    await page.setViewportSize({ width: 1440, height: 900 });
    const hydrationWarnings = collectHydrationWarnings(page);

    await resetFixture(request, "demo_board");
    await openExistingWorkspace(page);
    await installFrameRecorder(page);
    await clearPersistedQueryCache(page);
    const issuePath = `/workspace/${REEF_E2E_VAULT}/issues/REEF-101`;

    for (const [cacheState, count] of [
      ["cold", 3],
      ["warm", 3],
    ] as const) {
      for (let iteration = 1; iteration <= count; iteration += 1) {
        if (cacheState === "cold") await clearPersistedQueryCache(page);
        await setAuthControl(request, {
          probeDelayMs: 700,
          probeDelayOnce: true,
          session: "active",
        });
        await page.goto(issuePath, { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("issue-close")).toBeVisible();
        await page.waitForTimeout(150);
        await captureAndAssertContinuity(
          page,
          testInfo,
          `${cacheState}-${iteration}`,
        );
      }
    }

    expect(hydrationWarnings).toEqual([]);
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
    await page.route(
      (url) => url.pathname.includes("/_next/static/chunks/"),
      async (route) => {
        if (route.request().resourceType() !== "script") {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        const body = await response.text();
        if (!editorChunkIsHeld && body.includes("reef-markdown-editor")) {
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
});
