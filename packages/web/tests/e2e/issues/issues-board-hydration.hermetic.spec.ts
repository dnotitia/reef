import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  resetFixture,
  setAuthControl,
  setIssueListFailure,
  setPlanningCatalogFailure,
  waitForPasswordLogin,
} from "../harness/fixture";

// Regression guard for the warm-cache hydration mismatch on the issues board.
//
// REEF-315 promoted the workspace to `/workspace/[vault]/issues` and rewrote
// useActiveVault to read the vault from the URL synchronously. That removed the
// incidental `vault=""` hydration gate that used to keep `useIssueList`
// disabled on the first client render. On a hard reload the server SSRs the
// pending board skeleton (it has no persisted query cache), while the client's
// PersistQueryClientProvider rehydrates the warm issue-list cache from
// localStorage and renders the populated board on the very first client render —
// the exact "server rendered HTML didn't match the client" mismatch React
// reports as a recoverable hydration error.
//
// jsdom unit tests cannot catch this: a `render()` is a client-only mount where
// useHydrated() is already true, so the SSR↔hydration divergence never occurs.
// It only reproduces with real SSR + hydration + a warm persisted cache, hence
// this hermetic spec.
const board = '[data-testid="kanban-board"]';
const card = '[data-testid="kanban-card"]';

const isHydrationMessage = (text: string) =>
  /hydrat|did(?:n't| not) match|server rendered HTML/i.test(text);

async function captureBoardGeometry(
  page: Page,
  testInfo: TestInfo,
  phase: string,
) {
  const geometry = await page.evaluate((samplePhase) => {
    const boardElement = document.querySelector<HTMLElement>(
      '[data-testid="board-columns-skeleton"], [data-testid="kanban-board"]',
    );
    if (!boardElement) throw new Error("Board start was not present");
    const boardRect = boardElement.getBoundingClientRect();
    const boardStyle = getComputedStyle(boardElement);
    const frameElement = document.querySelector<HTMLElement>(
      '[data-testid="sprint-rollover-pending-skeleton"], [data-testid="sprint-rollover-nudge"]',
    );
    const frameRect = frameElement?.getBoundingClientRect();
    const frameStyle = frameElement ? getComputedStyle(frameElement) : null;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const round = (value: number) => Math.round(value * 10) / 10;

    return {
      phase: samplePhase,
      viewport,
      boardTestId: boardElement.dataset.testid,
      boardTop: round(boardRect.top),
      boardFrame: {
        height: round(boardRect.height),
        display: boardStyle.display,
        marginTop: boardStyle.marginTop,
        marginBottom: boardStyle.marginBottom,
        minHeight: boardStyle.minHeight,
      },
      rolloverFrame:
        frameElement && frameRect && frameStyle
          ? {
              testId: frameElement.dataset.testid,
              top: round(frameRect.top),
              height: round(frameRect.height),
              width: round(frameRect.width),
              styles: {
                display: frameStyle.display,
                flexDirection: frameStyle.flexDirection,
                boxSizing: frameStyle.boxSizing,
                minHeight: frameStyle.minHeight,
                marginBottom: frameStyle.marginBottom,
                paddingTop: frameStyle.paddingTop,
                paddingRight: frameStyle.paddingRight,
                paddingBottom: frameStyle.paddingBottom,
                paddingLeft: frameStyle.paddingLeft,
                borderTopWidth: frameStyle.borderTopWidth,
                borderTopStyle: frameStyle.borderTopStyle,
                borderTopColor: frameStyle.borderTopColor,
                backgroundColor: frameStyle.backgroundColor,
              },
            }
          : null,
    };
  }, phase);
  await mkdir(testInfo.outputDir, { recursive: true });
  const geometryPath = testInfo.outputPath(`${phase}.json`);
  const screenshotPath = testInfo.outputPath(`${phase}.png`);
  await writeFile(geometryPath, JSON.stringify(geometry, null, 2));
  await writeFile(
    screenshotPath,
    await page.screenshot({ animations: "disabled" }),
  );
  await testInfo.attach(`${phase}-geometry`, {
    path: geometryPath,
    contentType: "application/json",
  });
  await testInfo.attach(`${phase}-screen`, {
    path: screenshotPath,
    contentType: "image/png",
  });
  return geometry;
}

async function captureIssueViewGeometry(
  page: Page,
  testInfo: TestInfo,
  phase: string,
  view: "list" | "timeline",
) {
  const geometry = await page.evaluate(
    ({ samplePhase, sampleView }) => {
      const round = (value: number) => Math.round(value * 10) / 10;
      const measure = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing frame element: ${selector}`);
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          rect: {
            top: round(rect.top),
            left: round(rect.left),
            width: round(rect.width),
            height: round(rect.height),
          },
          styles: {
            display: style.display,
            position: style.position,
            boxSizing: style.boxSizing,
            minHeight: style.minHeight,
            marginBottom: style.marginBottom,
            paddingTop: style.paddingTop,
            paddingRight: style.paddingRight,
            paddingBottom: style.paddingBottom,
            paddingLeft: style.paddingLeft,
            borderBottomWidth: style.borderBottomWidth,
            borderBottomStyle: style.borderBottomStyle,
            borderBottomColor: style.borderBottomColor,
            backgroundColor: style.backgroundColor,
          },
        };
      };
      const body = document.querySelector<HTMLElement>(
        `[data-testid="issues-${sampleView}-loading"], [data-testid="issue-list-scroll-container"], [data-testid="timeline-grid-skeleton"], [data-testid="timeline-grid"]`,
      );
      if (!body) throw new Error(`Missing ${sampleView} loading frame`);
      const bodyRect = body.getBoundingClientRect();
      const bodyStyle = getComputedStyle(body);
      const skeleton = document.querySelector<HTMLElement>(
        `[data-testid="issues-${sampleView}-loading"]`,
      );
      const skeletonRect = skeleton?.getBoundingClientRect();
      const timelineGrid = document.querySelector<HTMLElement>(
        '[data-testid="timeline-grid-skeleton"]',
      );
      return {
        phase: samplePhase,
        view: sampleView,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        header: measure('[data-slot="page-header"]'),
        toolbar: measure('[data-testid="issue-filter-toolbar"]'),
        viewSwitcher: measure('[data-testid="view-switcher"]'),
        body: {
          testId: body.dataset.testid,
          top: round(bodyRect.top),
          width: round(bodyRect.width),
          height: round(bodyRect.height),
          display: bodyStyle.display,
          minHeight: bodyStyle.minHeight,
          overflow: bodyStyle.overflow,
          skeletonHeight: skeletonRect ? round(skeletonRect.height) : null,
          timelineGridWidth: timelineGrid
            ? round(timelineGrid.getBoundingClientRect().width)
            : null,
          skeletonRows: body.querySelectorAll('[data-testid="skeleton-row"]')
            .length,
          tableHeaders: body.querySelectorAll("thead th").length,
          skeletonBars: body.querySelectorAll(".reef-shimmer").length,
        },
      };
    },
    { samplePhase: phase, sampleView: view },
  );
  await mkdir(testInfo.outputDir, { recursive: true });
  const geometryPath = testInfo.outputPath(`${phase}.json`);
  const screenshotPath = testInfo.outputPath(`${phase}.png`);
  await writeFile(geometryPath, JSON.stringify(geometry, null, 2));
  await writeFile(
    screenshotPath,
    await page.screenshot({ animations: "disabled" }),
  );
  await testInfo.attach(`${phase}-geometry`, {
    path: geometryPath,
    contentType: "application/json",
  });
  await testInfo.attach(`${phase}-screen`, {
    path: screenshotPath,
    contentType: "image/png",
  });
  return geometry;
}

test.describe("Hermetic issues board hydration (REEF-315)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "demo_board");
  });

  for (const view of ["list", "timeline"] as const) {
    test(`keeps fixed issue chrome while the ${view} view code loads`, async ({
      context,
      page,
      request,
    }, testInfo) => {
      await context.clearCookies();
      await page.setViewportSize({ width: 1440, height: 900 });
      await resetFixture(request, "demo_board");
      await openExistingWorkspace(page);
      await expect(page.locator(board)).toBeVisible();
      await expect(page.locator(card).first()).toBeVisible();

      let releaseChunk = () => {};
      let heldChunkUrl = "";
      let heldScriptChunk = false;
      let resolveChunkHeld: (url: string) => void = () => {};
      const chunkHeld = new Promise<string>((resolve) => {
        resolveChunkHeld = resolve;
      });
      const chunkReleased = new Promise<void>((resolve) => {
        releaseChunk = resolve;
      });
      const chunkMatcher = (url: URL) =>
        url.pathname.includes("/_next/static/chunks/");
      const holdChunk = async (route: import("@playwright/test").Route) => {
        if (route.request().resourceType() !== "script") {
          await route.continue();
          return;
        }
        heldChunkUrl ||= route.request().url();
        if (!heldScriptChunk) {
          heldScriptChunk = true;
          resolveChunkHeld(heldChunkUrl);
        }
        await chunkReleased;
        await route.continue().catch(() => undefined);
      };

      await page.route(chunkMatcher, holdChunk);
      try {
        await page.getByTestId(`view-switcher-${view}`).click();
        const requestedChunk = await chunkHeld;
        expect(new URL(requestedChunk).pathname).toContain(
          "/_next/static/chunks/",
        );
        await expect(page).toHaveURL(new RegExp(`[?&]view=${view}(?:&|$)`));
        await expect(page.getByTestId(`issues-${view}-loading`)).toBeVisible();
        await expect(page.locator('[data-slot="page-header"]')).toBeVisible();
        await expect(page.getByTestId("issue-filter-toolbar")).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Issues" }),
        ).toBeVisible();

        const pending = await captureIssueViewGeometry(
          page,
          testInfo,
          `${view}-code-pending`,
          view,
        );

        if (view === "list") {
          const loadingView = page.getByTestId("issues-list-loading");
          await expect(
            loadingView.locator("table thead th").first(),
          ).toBeVisible({
            timeout: 1_000,
          });
          await expect(
            loadingView.getByTestId("skeleton-row").first(),
          ).toBeVisible({ timeout: 1_000 });
        } else {
          await expect(page.getByTestId("timeline-grid-skeleton")).toBeVisible({
            timeout: 1_000,
          });
          expect(pending.body.timelineGridWidth).toBeGreaterThan(1_000);
        }

        releaseChunk();
        await expect(
          page.getByTestId(
            view === "list" ? "issue-list-scroll-container" : "timeline-grid",
          ),
        ).toBeVisible();
        const ready = await captureIssueViewGeometry(
          page,
          testInfo,
          `${view}-code-ready`,
          view,
        );
        expect(pending.header).toEqual(ready.header);
        expect(pending.toolbar).toEqual(ready.toolbar);
        expect(pending.viewSwitcher.rect).toEqual(ready.viewSwitcher.rect);
      } finally {
        releaseChunk();
        await page.unroute(chunkMatcher, holdChunk);
      }
    });
  }

  test("warm-cache hard reload of the board does not hydration-mismatch", async ({
    page,
  }) => {
    const hydrationErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && isHydrationMessage(msg.text())) {
        hydrationErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      if (isHydrationMessage(err.message)) hydrationErrors.push(err.message);
    });

    // Land on the board; this populates the `['issues','list',vault]` query
    // cache with the demo_board issues.
    await openExistingWorkspace(page);
    await expect(page.locator(board)).toBeVisible();
    await expect(page.locator(card).first()).toBeVisible();

    // Wait for the throttled persister to flush the query cache to localStorage,
    // so the reload below rehydrates a WARM cache (the regression trigger). A
    // cold reload would render the skeleton on both sides and never diverge.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const raw =
              window.localStorage.getItem("REACT_QUERY_OFFLINE_CACHE") ?? "";
            return raw.includes('"issues"') ? "warm" : "cold";
          }),
        { timeout: 5_000 },
      )
      .toBe("warm");

    // Hard reload: SSR renders the pending board skeleton; the client rehydrates
    // the warm cache. The first client render must match the server's skeleton,
    // then reveal the cached board on the post-mount render (useIssueList
    // hydration gate). A mismatch here is logged as a recoverable React error.
    await page.reload({ waitUntil: "load" });

    // The board still renders the cached issues after hydration settles.
    await expect(page.locator(board)).toBeVisible();
    await expect(page.locator(card).first()).toBeVisible();

    expect(
      hydrationErrors,
      `Unexpected hydration mismatch(es):\n${hydrationErrors.join("\n---\n")}`,
    ).toEqual([]);
  });

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "narrow", width: 390, height: 844 },
  ]) {
    test(`keeps the first-login rollover frame stable at ${viewport.name} width`, async ({
      context,
      page,
      request,
    }, testInfo) => {
      await context.clearCookies();
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await resetFixture(request, "demo_board");
      await page.goto(
        `/login?redirect=${encodeURIComponent(`/workspace/${REEF_E2E_VAULT}/issues`)}`,
      );
      await waitForPasswordLogin(page);

      // Hold each real external AKB read long enough to sample auth pending,
      // planning-ready/issue-pending, and the resolved rollover card.
      await setPlanningCatalogFailure(request, false, 250);
      await setIssueListFailure(request, false, 0, 2_200);
      await setAuthControl(request, {
        probeDelayMs: 2_000,
        probeDelayOnce: true,
      });

      const planningStarted = page.waitForRequest((e2eRequest) => {
        const url = new URL(e2eRequest.url());
        return url.pathname === "/api/planning";
      });
      const issueListStarted = page.waitForRequest((e2eRequest) =>
        new URL(e2eRequest.url()).pathname.startsWith("/api/issues"),
      );
      const planningLoaded = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/planning";
      });
      const loginResponsePromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/auth/akb/login" &&
          response.request().method() === "POST",
      );

      await page.locator('[data-testid="login-username"]').fill("alice");
      await page.locator('[data-testid="login-password"]').fill("password");
      await page.locator('[data-testid="login-submit"]').click();
      const loginResponse = await loginResponsePromise;
      expect(
        loginResponse.ok(),
        `POST /api/auth/akb/login failed with ${loginResponse.status()}`,
      ).toBeTruthy();
      await expect(page).toHaveURL(
        new RegExp(`/workspace/${REEF_E2E_VAULT}/issues/?(?:\\?[^#]*)?$`),
      );
      await expect(page.getByTestId("issues-skeleton")).toBeVisible();
      const authPending = await captureBoardGeometry(
        page,
        testInfo,
        `${viewport.name}-auth-pending`,
      );

      await Promise.all([planningStarted, issueListStarted]);
      await planningLoaded;
      const dataPending = await captureBoardGeometry(
        page,
        testInfo,
        `${viewport.name}-planning-ready-issues-pending`,
      );

      await expect(
        page.locator("[data-testid='sprint-rollover-nudge']"),
      ).toBeVisible();
      await expect(page.locator(board)).toBeVisible();
      await expect(page.locator(card).first()).toBeVisible();
      const ready = await captureBoardGeometry(
        page,
        testInfo,
        `${viewport.name}-nudge-and-board-ready`,
      );

      const nudge = page.locator('[data-testid="sprint-rollover-nudge"]');
      const dismiss = page.getByRole("button", {
        name: "Dismiss sprint rollover notice",
      });
      const intentionalFrameHeight = await nudge.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.height + Number.parseFloat(style.marginBottom);
      });
      await dismiss.click();
      await expect(nudge).toHaveCount(0);
      const dismissed = await captureBoardGeometry(
        page,
        testInfo,
        `${viewport.name}-user-dismissed`,
      );

      expect(dataPending.rolloverFrame?.testId).toBe(
        "sprint-rollover-pending-skeleton",
      );
      expect(authPending.rolloverFrame?.testId).toBe(
        "sprint-rollover-pending-skeleton",
      );
      expect(dataPending.rolloverFrame?.height).toBe(
        ready.rolloverFrame?.height,
      );
      expect(dataPending.rolloverFrame?.styles.marginBottom).toBe(
        ready.rolloverFrame?.styles.marginBottom,
      );
      expect(dataPending.rolloverFrame?.styles.flexDirection).toBe(
        ready.rolloverFrame?.styles.flexDirection,
      );
      expect(
        Math.abs(dataPending.boardTop - ready.boardTop),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(ready.boardTop - dismissed.boardTop - intentionalFrameHeight),
      ).toBeLessThanOrEqual(1);
    });
  }

  for (const scenario of [
    "configured_empty",
    "sprint_rollover_empty",
  ] as const) {
    test(`removes the pending frame when ${scenario} cannot show a nudge`, async ({
      context,
      page,
      request,
    }) => {
      await context.clearCookies();
      await resetFixture(request, scenario);
      await openExistingWorkspace(page);

      await expect(page.locator(board)).toBeVisible();
      await expect(
        page.getByTestId("sprint-rollover-pending-skeleton"),
      ).toHaveCount(0);
      await expect(page.getByTestId("sprint-rollover-nudge")).toHaveCount(0);
    });
  }
});
