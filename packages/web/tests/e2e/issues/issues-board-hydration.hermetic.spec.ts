import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  setAuthControl,
  setIssueListFailure,
  setPlanningCatalogFailure,
  waitForPasswordLogin,
  writeIndexedDbConfig,
} from "../harness/fixture";
import { PERSISTED_QUERY_CACHE_KEY } from "../../../src/lib/storage/clientCache";

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

  test("keeps the rollover row readable across viewport, locale, and theme combinations", async ({
    context,
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    await context.clearCookies();
    await resetFixture(request, "sprint_rollover");
    await page.setViewportSize({ width: 1440, height: 900 });
    await openExistingWorkspace(page);

    const catalogResponse = await page.request.get(
      `/api/planning?vault=${REEF_E2E_VAULT}`,
    );
    expect(catalogResponse.ok()).toBeTruthy();
    const catalog = (await catalogResponse.json()) as {
      sprints: Array<{
        id: string;
        name: string;
        status: string;
        start_date: string | null;
        end_date: string | null;
        goal: string;
        capacity_points: number | null;
      }>;
    };
    const activeSprint = catalog.sprints.find(
      (sprint) => sprint.status === "active",
    );
    if (!activeSprint) throw new Error("Active fixture sprint is missing");
    const longName = `Sprint 14 - Rollover fixture — ${"긴스프린트이름확인용".repeat(5)}`;
    const updateResponse = await page.request.put(
      `/api/planning/sprints/${activeSprint.id}`,
      {
        data: {
          vault: REEF_E2E_VAULT,
          item: { ...activeSprint, name: longName },
        },
      },
    );
    expect(updateResponse.ok()).toBeTruthy();
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults
          .find((vault) => vault.name === REEF_E2E_VAULT)
          ?.sprints.find((sprint) => sprint.id === activeSprint.id)?.name;
      })
      .toBe(longName);

    await page.close();
    const visualPage = await context.newPage();
    await visualPage.goto("/api/healthz");
    await visualPage.evaluate((cacheKey) => {
      window.localStorage.removeItem(cacheKey);
    }, PERSISTED_QUERY_CACHE_KEY);
    await visualPage.goto(`/workspace/${REEF_E2E_VAULT}/issues`);
    await expect(visualPage.getByTestId("sprint-rollover-nudge")).toBeVisible();
    await expect(visualPage.getByTestId("sprint-rollover-nudge")).toContainText(
      longName,
    );

    const widths = [320, 375, 414, 768, 1440];
    const locales = ["en", "ko"] as const;
    const themes = ["light", "dark"] as const;
    for (const locale of locales) {
      await context.addCookies([
        {
          name: "NEXT_LOCALE",
          value: locale,
          url: visualPage.url(),
        },
      ]);
      for (const theme of themes) {
        await writeIndexedDbConfig(visualPage, "theme", theme);
        await visualPage.evaluate((preference) => {
          window.localStorage.setItem("reef.theme", preference);
        }, theme);
        await visualPage.emulateMedia({ colorScheme: theme });
        await visualPage.reload();
        await expect(
          visualPage.getByTestId("sprint-rollover-nudge"),
        ).toBeVisible();
        await expect(visualPage.locator("html")).toHaveAttribute(
          "lang",
          locale,
        );
        await expect(
          visualPage.getByTestId("sprint-rollover-nudge"),
        ).toContainText(longName);

        for (const width of widths) {
          await visualPage.setViewportSize({ width, height: 900 });
          const sample = `${locale}-${theme}-${width}`;
          const geometry = await visualPage.evaluate((sampleName) => {
            const row = document.querySelector<HTMLElement>(
              '[data-testid="sprint-rollover-nudge"]',
            );
            const toolbar = document.querySelector<HTMLElement>(
              '[data-testid="issue-filter-toolbar"]',
            );
            const board = document.querySelector<HTMLElement>(
              '[data-testid="kanban-board"]',
            );
            if (!row || !toolbar || !board) {
              throw new Error("Rollover row, toolbar, or board is missing");
            }
            const title = row.querySelector<HTMLElement>("p");
            const description = row.querySelectorAll<HTMLElement>("p")[1];
            const action = row.querySelector<HTMLButtonElement>("button");
            const dismiss =
              row.querySelectorAll<HTMLButtonElement>("button")[1];
            if (!title || !description || !action || !dismiss) {
              throw new Error("Rollover copy or actions are missing");
            }
            const rect = (element: Element) => {
              const bounds = element.getBoundingClientRect();
              const round = (value: number) => Math.round(value * 10) / 10;
              return {
                top: round(bounds.top),
                right: round(bounds.right),
                bottom: round(bounds.bottom),
                left: round(bounds.left),
                width: round(bounds.width),
                height: round(bounds.height),
              };
            };
            const textLineCount = (element: HTMLElement) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              return range.getClientRects().length;
            };
            const rowStyle = getComputedStyle(row);
            const titleStyle = getComputedStyle(title);
            const descriptionStyle = getComputedStyle(description);
            const toolbarStyle = getComputedStyle(toolbar);
            const contentElement = title.parentElement;
            const actionsElement = action.parentElement;
            const contentRect = contentElement?.getBoundingClientRect();
            const actionsRect = actionsElement?.getBoundingClientRect();
            return {
              sample: sampleName,
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
              },
              locale: document.documentElement.lang,
              dark: document.documentElement.classList.contains("dark"),
              titleText: title.innerText,
              descriptionText: description.innerText,
              row: rect(row),
              content:
                contentRect && contentElement ? rect(contentElement) : null,
              actions:
                actionsRect && actionsElement ? rect(actionsElement) : null,
              action: rect(action),
              dismiss: rect(dismiss),
              toolbar: {
                ...rect(toolbar),
                paddingLeft: toolbarStyle.paddingLeft,
                paddingRight: toolbarStyle.paddingRight,
              },
              board: rect(board),
              documentWidth: document.documentElement.scrollWidth,
              styles: {
                rowBackground: rowStyle.backgroundColor,
                rowBorderBottomColor: rowStyle.borderBottomColor,
                rowBorderBottomWidth: rowStyle.borderBottomWidth,
                rowBorderRadius: rowStyle.borderRadius,
                titleColor: titleStyle.color,
                titleFontSize: titleStyle.fontSize,
                titleLineHeight: titleStyle.lineHeight,
                titleScrollHeight: title.scrollHeight,
                titleClientHeight: title.clientHeight,
                descriptionColor: descriptionStyle.color,
                descriptionFontSize: descriptionStyle.fontSize,
                descriptionLineHeight: descriptionStyle.lineHeight,
                descriptionScrollHeight: description.scrollHeight,
                descriptionClientHeight: description.clientHeight,
                actionTextLines: textLineCount(action),
              },
            };
          }, sample);

          expect(geometry.locale).toBe(locale);
          expect(geometry.dark).toBe(theme === "dark");
          expect(geometry.titleText).toContain(longName);
          expect(geometry.descriptionText).toMatch(/2|두/);
          expect(geometry.row.left).toBeGreaterThanOrEqual(0);
          expect(geometry.row.right).toBeLessThanOrEqual(width);
          expect(geometry.documentWidth).toBeLessThanOrEqual(width);
          expect(geometry.row.left).toBeCloseTo(
            geometry.toolbar.left +
              Number.parseFloat(geometry.toolbar.paddingLeft),
            0,
          );
          expect(geometry.row.right).toBeCloseTo(
            geometry.toolbar.right -
              Number.parseFloat(geometry.toolbar.paddingRight),
            0,
          );
          expect(geometry.content).not.toBeNull();
          expect(geometry.actions).not.toBeNull();
          expect(geometry.action.top + geometry.action.height / 2).toBeCloseTo(
            geometry.dismiss.top + geometry.dismiss.height / 2,
            0,
          );
          expect(geometry.styles.actionTextLines).toBe(1);
          expect(geometry.styles.titleScrollHeight).toBe(
            geometry.styles.titleClientHeight,
          );
          expect(geometry.styles.descriptionScrollHeight).toBe(
            geometry.styles.descriptionClientHeight,
          );
          expect(geometry.styles.rowBorderBottomWidth).toBe("1px");
          expect(geometry.styles.rowBorderRadius).toBe("0px");
          expect(geometry.styles.rowBackground).not.toBe("rgba(0, 0, 0, 0)");
          expect(geometry.styles.rowBorderBottomColor).not.toBe(
            "rgba(0, 0, 0, 0)",
          );
          expect(geometry.styles.titleColor).not.toBe(
            geometry.styles.descriptionColor,
          );

          if (width < 640) {
            expect(geometry.content?.bottom).toBeLessThanOrEqual(
              geometry.actions?.top ?? 0,
            );
          } else {
            expect(geometry.content?.right).toBeLessThanOrEqual(
              geometry.actions?.left ?? 0,
            );
          }

          const geometryPath = testInfo.outputPath(`${sample}.json`);
          const screenshotPath = testInfo.outputPath(`${sample}.png`);
          await mkdir(testInfo.outputDir, { recursive: true });
          await writeFile(geometryPath, JSON.stringify(geometry, null, 2));
          await writeFile(
            screenshotPath,
            await visualPage.screenshot({ animations: "disabled" }),
          );
          await testInfo.attach(`${sample}-geometry`, {
            path: geometryPath,
            contentType: "application/json",
          });
          await testInfo.attach(`${sample}-screen`, {
            path: screenshotPath,
            contentType: "image/png",
          });
        }
      }
    }
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
      // A response event can resolve before React commits the catalog update or
      // replaces the route Suspense fallback. Sample the live pending workspace,
      // not a still-painted IssuesWorkspaceSkeleton from that intermediate frame.
      await expect(page.getByTestId("issues-skeleton")).toHaveCount(0);
      await expect(page.getByTestId("current-sprint-shortcut")).toBeVisible();
      await expect(
        page.getByTestId("sprint-rollover-pending-skeleton"),
      ).toBeVisible();
      await expect(page.getByTestId("board-columns-skeleton")).toBeVisible();
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
