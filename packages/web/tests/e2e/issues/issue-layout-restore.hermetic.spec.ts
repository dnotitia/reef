import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";
import {
  openExistingWorkspace,
  releaseAuthProbe,
  resetFixture,
  setAuthControl,
  setIssueListFailure,
} from "../harness/fixture";

const WIDTH_KEY = "reef:issue-detail-width:v2";
const HEIGHT_KEY = "reef:issue-description-height:v1";
const FRAME_KEY = "reef:layout-reload-frames";
const ISSUE_PATH = "/workspace/reef-e2e/issues/REEF-101?view=list";
const SAVED_WIDTH = 1200;
const SAVED_HEIGHT = 740;

interface LayoutFrame {
  phase: "auth-pending" | "detail-skeleton" | "editor-loading" | "loaded";
  timeMs: number;
  navigationTimeOrigin: number;
  viewportWidth: number;
  viewportHeight: number;
  panelWidth: number | null;
  panelCssWidth: string | null;
  panelCssMaxWidth: string | null;
  panelTransition: string | null;
  panelAnimation: string | null;
  bodyHeight: number | null;
  toolbarHeight: number | null;
  toolbarControlsHeight: number | null;
  toolbarSourceHeight: number | null;
  toolbarChildHeights: number[];
  lowerSectionTop: number | null;
  darkTheme: boolean;
  documentOverflow: boolean;
  panelOverflow: boolean;
}

test.use({ video: "on" });

test.describe("Hermetic persisted issue layout", () => {
  test("holds the saved panel and Description geometry through reload loading states", async ({
    context,
    page,
    request,
  }, testInfo) => {
    testInfo.setTimeout(60_000);
    await context.clearCookies();
    await resetFixture(request, "demo_board");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await openExistingWorkspace(page);
    await page.goto(ISSUE_PATH);
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const panelHandle = page.getByTestId("issue-detail-resize-handle");
    await expect(panelHandle).toBeVisible();
    await expect(panelHandle).toHaveAttribute("aria-valuenow", /1353\.6/);
    await panelHandle.focus();
    await page.keyboard.press("Home");
    await expect(panelHandle).toHaveAttribute("aria-valuenow", "1200");

    const descriptionHandle = page.getByTestId("markdown-editor-resize-handle");
    await expect(descriptionHandle).toBeVisible();
    await expect(descriptionHandle).toHaveAttribute("aria-valuenow", "320");
    await descriptionHandle.focus();
    await page.keyboard.press("End");
    await expect(descriptionHandle).toHaveAttribute(
      "aria-valuenow",
      String(SAVED_HEIGHT),
    );
    await expect
      .poll(() =>
        page.evaluate(
          ({ widthKey, heightKey }) => ({
            width: sessionStorage.getItem(widthKey),
            height: sessionStorage.getItem(heightKey),
          }),
          { widthKey: WIDTH_KEY, heightKey: HEIGHT_KEY },
        ),
      )
      .toEqual({
        width: JSON.stringify(SAVED_WIDTH),
        height: JSON.stringify(SAVED_HEIGHT),
      });

    const originalSheet = page.getByTestId("issue-detail-modal");
    await originalSheet.evaluate((element) => {
      element.setAttribute("data-reef-regression-sheet", "entry");
    });
    await page
      .locator('[data-testid="issue-children"] a[data-issue-id="REEF-102"]')
      .click();
    await page.waitForURL(/\/issues\/REEF-102\?view=list$/);
    await expect(
      page.locator(
        '[data-testid="issue-detail-modal"][data-reef-regression-sheet="entry"]',
      ),
    ).toHaveCount(1);
    await expect(page.getByTestId("issue-drill-back")).toHaveAttribute(
      "data-back-to",
      "REEF-101",
    );
    await expect(
      page.getByTestId("issue-detail-resize-handle"),
    ).toHaveAttribute("aria-valuenow", String(SAVED_WIDTH));
    await expect(
      page.getByTestId("markdown-editor-resize-handle"),
    ).toHaveAttribute("aria-valuenow", String(SAVED_HEIGHT));
    await page.getByTestId("issue-drill-back").click();
    await page.waitForURL(/\/issues\/REEF-101\?view=list$/);
    await expect(
      page.locator(
        '[data-testid="issue-detail-modal"][data-reef-regression-sheet="entry"]',
      ),
    ).toHaveCount(1);
    await expect(panelHandle).toHaveAttribute(
      "aria-valuenow",
      String(SAVED_WIDTH),
    );
    await expect(descriptionHandle).toHaveAttribute(
      "aria-valuenow",
      String(SAVED_HEIGHT),
    );

    const hydrationWarnings: string[] = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /hydration|did not match|server html/i.test(message.text())
      ) {
        hydrationWarnings.push(message.text());
      }
    });
    page.on("pageerror", (error) => hydrationWarnings.push(error.message));

    await page.addInitScript((frameKey) => {
      const frames: LayoutFrame[] = [];
      const record = () => {
        if (location.pathname !== "/workspace/reef-e2e/issues/REEF-101") {
          requestAnimationFrame(record);
          return;
        }

        const appShell = document.querySelector(
          '[data-testid="app-shell-skeleton"]',
        );
        const detailSkeleton = document.querySelector(
          '[data-testid="issue-detail-skeleton"]',
        );
        const editorSkeleton = document.querySelector(
          '[data-testid="markdown-editor-skeleton"]',
        );
        const editor = document.querySelector(
          '[data-testid="markdown-editor"]',
        );
        const phase: LayoutFrame["phase"] = appShell
          ? "auth-pending"
          : detailSkeleton
            ? "detail-skeleton"
            : editorSkeleton
              ? "editor-loading"
              : editor
                ? "loaded"
                : "detail-skeleton";
        const panel =
          document.querySelector<HTMLElement>(
            '[data-testid="issue-detail-modal"].issue-detail-sheet',
          ) ?? document.querySelector<HTMLElement>(".issue-detail-sheet");
        const bodyFrame = document.querySelector<HTMLElement>(
          '[data-testid="markdown-editor-skeleton-body-frame"], #issue-description [data-testid="markdown-editor-body-frame"]',
        );
        const toolbar = document.querySelector<HTMLElement>(
          '[data-testid="markdown-toolbar"]',
        );
        const toolbarControls = document.querySelector<HTMLElement>(
          '[data-testid="markdown-toolbar-controls"]',
        );
        const toolbarSource = document.querySelector<HTMLElement>(
          '[data-testid="markdown-source-toggle"]',
        );
        const descriptionLabel = document.querySelector<HTMLElement>(
          '[data-testid="issue-detail-description-label"]',
        );
        const descriptionGroup = descriptionLabel?.parentElement;
        const lowerSection = descriptionGroup?.nextElementSibling;
        const panelElement = panel?.querySelector<HTMLElement>(
          '[data-testid="issue-detail-scroll"]',
        );
        const panelStyle = panel ? getComputedStyle(panel) : null;
        const frame: LayoutFrame = {
          phase,
          timeMs: performance.now(),
          navigationTimeOrigin: performance.timeOrigin,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          panelWidth: panel ? panel.getBoundingClientRect().width : null,
          panelCssWidth: panelStyle?.width ?? null,
          panelCssMaxWidth: panelStyle?.maxWidth ?? null,
          panelTransition: panel
            ? `${panelStyle?.transitionProperty} ${panelStyle?.transitionDuration}`
            : null,
          panelAnimation: panelStyle?.animationName ?? null,
          bodyHeight: bodyFrame
            ? bodyFrame.getBoundingClientRect().height
            : null,
          toolbarHeight: toolbar
            ? toolbar.getBoundingClientRect().height
            : null,
          toolbarControlsHeight: toolbarControls
            ? toolbarControls.getBoundingClientRect().height
            : null,
          toolbarSourceHeight: toolbarSource
            ? toolbarSource.getBoundingClientRect().height
            : null,
          toolbarChildHeights: toolbar
            ? Array.from(toolbar.children).map(
                (child) => child.getBoundingClientRect().height,
              )
            : [],
          lowerSectionTop: lowerSection
            ? lowerSection.getBoundingClientRect().top
            : null,
          darkTheme: document.documentElement.classList.contains("dark"),
          documentOverflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
          panelOverflow: panelElement
            ? panelElement.scrollWidth > panelElement.clientWidth
            : false,
        };
        if (frames.length < 900) {
          frames.push(frame);
          try {
            sessionStorage.setItem(frameKey, JSON.stringify(frames));
          } catch {
            // The evidence collector must not change the browser flow.
          }
        }
        requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
    }, FRAME_KEY);

    await page.evaluate((key) => sessionStorage.setItem(key, "[]"), FRAME_KEY);
    await setAuthControl(request, {
      probeHold: true,
    });
    await setIssueListFailure(request, false, 0, 1_400);
    await page.route("**/_next/static/chunks/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 450));
      await route.continue();
    });

    const reload = page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("app-shell-skeleton")).toBeVisible();
    const authScreenshot = await page.screenshot({
      path: testInfo.outputPath("auth-pending.png"),
    });
    await testInfo.attach("auth-pending", {
      body: authScreenshot,
      contentType: "image/png",
    });
    await releaseAuthProbe(request);
    await reload;

    await expect(page.getByTestId("app-shell-skeleton")).toHaveCount(0);
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await expect(page.getByTestId("markdown-editor-skeleton")).toBeVisible({
      timeout: 10_000,
    });
    const loadingScreenshot = await page.screenshot({
      path: testInfo.outputPath("editor-chunk-loading.png"),
    });
    await testInfo.attach("editor-chunk-loading", {
      body: loadingScreenshot,
      contentType: "image/png",
    });
    await expect(page.getByTestId("markdown-editor")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("markdown-editor-resize-handle"),
    ).toHaveAttribute("aria-valuenow", String(SAVED_HEIGHT));
    const loadedScreenshot = await page.screenshot({
      path: testInfo.outputPath("loaded-editor.png"),
    });
    await testInfo.attach("loaded-editor", {
      body: loadedScreenshot,
      contentType: "image/png",
    });

    const frames = await page.evaluate((key) => {
      return JSON.parse(sessionStorage.getItem(key) ?? "[]") as LayoutFrame[];
    }, FRAME_KEY);
    const framePath = testInfo.outputPath("frame-geometry.json");
    await mkdir(dirname(framePath), { recursive: true });
    await writeFile(framePath, JSON.stringify(frames, null, 2));
    await testInfo.attach("frame-geometry", {
      body: JSON.stringify(frames, null, 2),
      contentType: "application/json",
    });

    const persistedGeometry = await page.evaluate(
      ({ widthKey, heightKey }) => ({
        width: sessionStorage.getItem(widthKey),
        height: sessionStorage.getItem(heightKey),
        initialWidth: getComputedStyle(
          document.documentElement,
        ).getPropertyValue("--reef-issue-detail-initial-width"),
        initialHeight: getComputedStyle(
          document.documentElement,
        ).getPropertyValue("--reef-markdown-editor-initial-frame-height"),
      }),
      { widthKey: WIDTH_KEY, heightKey: HEIGHT_KEY },
    );
    const diagnosticPhases: LayoutFrame["phase"][] = [
      "detail-skeleton",
      "auth-pending",
      "editor-loading",
      "loaded",
    ];
    console.log(
      "[LAYOUT_RELOAD_PERSISTED_GEOMETRY]",
      JSON.stringify(persistedGeometry),
    );
    for (const phase of diagnosticPhases) {
      const phaseFrames = frames.filter((frame) => frame.phase === phase);
      const panelStyles = new Map(
        phaseFrames.map((frame) => [
          JSON.stringify([
            frame.panelCssWidth,
            frame.panelCssMaxWidth,
            frame.panelTransition,
            frame.panelAnimation,
          ]),
          {
            width: frame.panelCssWidth,
            maxWidth: frame.panelCssMaxWidth,
            transition: frame.panelTransition,
            animation: frame.panelAnimation,
          },
        ]),
      );
      console.log(
        "[LAYOUT_RELOAD_GEOMETRY]",
        JSON.stringify({
          phase,
          navigationTimeOrigins: [
            ...new Set(phaseFrames.map((frame) => frame.navigationTimeOrigin)),
          ],
          viewports: [
            ...new Set(
              phaseFrames.map(
                (frame) => `${frame.viewportWidth}x${frame.viewportHeight}`,
              ),
            ),
          ],
          panelStyles: [...panelStyles.values()],
          samples: phaseFrames.map((frame) => [
            Math.round(frame.timeMs * 100) / 100,
            frame.panelWidth,
            frame.bodyHeight,
          ]),
        }),
      );
    }

    const authFrames = frames.filter((frame) => frame.phase === "auth-pending");
    const loadingFrames = frames.filter(
      (frame) => frame.phase === "editor-loading",
    );
    const loadedFrames = frames.filter((frame) => frame.phase === "loaded");
    expect(authFrames.length).toBeGreaterThan(0);
    expect(loadingFrames.length).toBeGreaterThan(0);
    expect(loadedFrames.length).toBeGreaterThan(0);

    for (const phaseFrames of [authFrames, loadingFrames, loadedFrames]) {
      expect(
        phaseFrames.every(
          (frame) => Math.abs((frame.panelWidth ?? 0) - SAVED_WIDTH) <= 1,
        ),
      ).toBe(true);
      expect(
        phaseFrames.every(
          (frame) => Math.abs((frame.bodyHeight ?? 0) - SAVED_HEIGHT) <= 1,
        ),
      ).toBe(true);
    }

    const skeletonFrame = loadingFrames[loadingFrames.length - 1];
    const loadedFrame = loadedFrames[loadedFrames.length - 1];
    expect(skeletonFrame?.toolbarHeight).not.toBeNull();
    expect(loadedFrame?.toolbarHeight).toBeCloseTo(
      skeletonFrame?.toolbarHeight ?? 0,
      0,
    );
    expect(loadedFrame?.lowerSectionTop).toBeCloseTo(
      skeletonFrame?.lowerSectionTop ?? 0,
      0,
    );
    const lowerSectionTops = [...authFrames, ...loadingFrames, ...loadedFrames]
      .map((frame) => frame.lowerSectionTop)
      .filter((top): top is number => top !== null);
    expect(
      Math.max(...lowerSectionTops) - Math.min(...lowerSectionTops),
    ).toBeLessThanOrEqual(1);
    expect(frames.every((frame) => !frame.documentOverflow)).toBe(true);
    expect(frames.every((frame) => !frame.panelOverflow)).toBe(true);
    expect(new Set(frames.map((frame) => frame.darkTheme)).size).toBe(1);
    expect(hydrationWarnings).toEqual([]);

    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(page.getByTestId("issue-detail-resize-handle")).toHaveCount(0);
    await expect(
      page.getByTestId("markdown-editor-resize-handle"),
    ).toBeVisible();
    const narrowGeometry = await page.evaluate(() => {
      const panel =
        document.querySelector<HTMLElement>(
          '[data-testid="issue-detail-modal"].issue-detail-sheet',
        ) ?? document.querySelector<HTMLElement>(".issue-detail-sheet");
      const frame = document.querySelector<HTMLElement>(
        '#issue-description [data-testid="markdown-editor-body-frame"]',
      );
      const toolbar = document.querySelector<HTMLElement>(
        '#issue-description [data-testid="markdown-toolbar"]',
      );
      if (!panel || !frame || !toolbar) {
        throw new Error("Issue layout geometry is not mounted");
      }
      return {
        panelWidth: panel.getBoundingClientRect().width,
        bodyHeight: frame.getBoundingClientRect().height,
        toolbarHeight: toolbar.getBoundingClientRect().height,
        panelOverflow: panel.scrollWidth > panel.clientWidth,
        documentOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      };
    });
    expect(narrowGeometry.panelWidth).toBeCloseTo(1024 * 0.94, 0);
    expect(narrowGeometry.bodyHeight).toBe(SAVED_HEIGHT);
    expect(narrowGeometry.toolbarHeight).toBeGreaterThan(
      loadedFrame?.toolbarHeight ?? 0,
    );
    expect(narrowGeometry.panelOverflow).toBe(false);
    expect(narrowGeometry.documentOverflow).toBe(false);
    const narrowScreenshot = await page.screenshot({
      path: testInfo.outputPath("narrow-toolbar-wrap.png"),
    });
    await testInfo.attach("narrow-toolbar-wrap", {
      body: narrowScreenshot,
      contentType: "image/png",
    });

    await page.setViewportSize({ width: 1440, height: 900 });

    const verifyStoredValuesDuringAuth = async ({
      name,
      expectedWidth,
      expectedHeight,
    }: {
      name: string;
      expectedWidth: number;
      expectedHeight: number;
    }) => {
      await setAuthControl(request, { probeHold: true });
      const heldReload = page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("app-shell-skeleton")).toBeVisible();
      const bootstrapGeometry = await page.evaluate(() => {
        const rootStyle = getComputedStyle(document.documentElement);
        const panel = document.querySelector<HTMLElement>(
          '[data-testid="issue-detail-modal"].issue-detail-sheet',
        );
        const frame = document.querySelector<HTMLElement>(
          '[data-testid="markdown-editor-skeleton-body-frame"]',
        );
        return {
          panelWidth: panel?.getBoundingClientRect().width ?? null,
          bodyHeight: frame?.getBoundingClientRect().height ?? null,
          rootWidth: rootStyle.getPropertyValue(
            "--reef-issue-detail-initial-width",
          ),
          rootHeight: rootStyle.getPropertyValue(
            "--reef-markdown-editor-initial-frame-height",
          ),
        };
      });
      expect(bootstrapGeometry.panelWidth).toBeCloseTo(expectedWidth, 0);
      expect(bootstrapGeometry.bodyHeight).toBe(expectedHeight);
      expect(Number.parseFloat(bootstrapGeometry.rootWidth)).toBeCloseTo(
        expectedWidth,
        0,
      );
      expect(Number.parseFloat(bootstrapGeometry.rootHeight)).toBe(
        expectedHeight,
      );
      const screenshot = await page.screenshot({
        path: testInfo.outputPath(`${name}-auth-pending.png`),
      });
      await testInfo.attach(`${name}-auth-pending`, {
        body: screenshot,
        contentType: "image/png",
      });
      await releaseAuthProbe(request);
      await heldReload;
      await expect(page.getByTestId("app-shell-skeleton")).toHaveCount(0);
      await expect(page.getByTestId("markdown-editor")).toBeVisible();
      const restoredPanelWidth = Number(
        await panelHandle.getAttribute("aria-valuenow"),
      );
      const restoredEditorHeight = Number(
        await descriptionHandle.getAttribute("aria-valuenow"),
      );
      expect(restoredPanelWidth).toBeCloseTo(expectedWidth, 0);
      expect(restoredEditorHeight).toBe(expectedHeight);
    };

    await page.evaluate(
      ({ widthKey, heightKey, frameKey }) => {
        sessionStorage.setItem(widthKey, "5000");
        sessionStorage.setItem(heightKey, "9000");
        sessionStorage.setItem(frameKey, "[]");
      },
      { widthKey: WIDTH_KEY, heightKey: HEIGHT_KEY, frameKey: FRAME_KEY },
    );
    await verifyStoredValuesDuringAuth({
      name: "out-of-range-values",
      expectedWidth: 1440 * 0.94,
      expectedHeight: SAVED_HEIGHT,
    });

    await page.evaluate(
      ({ widthKey, heightKey, frameKey }) => {
        sessionStorage.setItem(widthKey, "not-json");
        sessionStorage.setItem(heightKey, "{broken");
        sessionStorage.setItem(frameKey, "[]");
      },
      { widthKey: WIDTH_KEY, heightKey: HEIGHT_KEY, frameKey: FRAME_KEY },
    );
    await verifyStoredValuesDuringAuth({
      name: "corrupt-values",
      expectedWidth: 1440 * 0.94,
      expectedHeight: 320,
    });
    expect(hydrationWarnings).toEqual([]);
  });
});
