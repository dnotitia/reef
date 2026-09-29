import { writeFile } from "node:fs/promises";
import { type Page, type TestInfo, expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "../harness/fixture";

// UI-only timing: these tests assert a purely visual in-flight indicator — the
// shared SearchProgressBar hairline (REEF-369). reef-web's real /api/issues
// route still handles every request (route.continue keeps the payload
// untouched); page.route only DELAYS the search responses so the brief
// in-flight window is observable instead of racing to zero. This is the
// documented UI-only exception to the "don't page.route reef's own /api/*"
// rule — the timing, not the behavior, is what's stubbed.

const HAIRLINE = '[data-testid="search-progress-bar"]';
const UPDATING_STATUS = '[role="status"][aria-live="polite"]';

interface SearchProgressSample {
  elapsedMs: number;
  bars: Array<{
    top: number;
    height: number;
    position: string;
    display: string;
    visibility: string;
    animationName: string;
  }>;
  updatingAnnouncements: number;
}

interface SearchProgressSummary {
  frames: number;
  activeFrames: number;
  maxBars: number;
  maxUpdatingAnnouncements: number;
  activeBarTops: number[];
  activeBarHeights: number[];
  activeBarPositions: string[];
  activeAnimationNames: string[];
}

async function installSearchProgressSampler(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Sample = {
      elapsedMs: number;
      bars: Array<{
        top: number;
        height: number;
        position: string;
        display: string;
        visibility: string;
        animationName: string;
      }>;
      updatingAnnouncements: number;
    };
    type Capture = { startedAt: number; samples: Sample[] };
    const browserWindow = window as Window & {
      __reefSearchProgressCapture?: Capture;
    };
    const capture: Capture = { startedAt: performance.now(), samples: [] };
    browserWindow.__reefSearchProgressCapture = capture;

    const sample = () => {
      const bars = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="search-progress-bar"]',
        ),
      ).filter((bar) => {
        const style = getComputedStyle(bar);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          bar.getClientRects().length > 0
        );
      });
      const updatingAnnouncements = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="status"][aria-live="polite"]',
        ),
      ).filter((status) =>
        status.textContent?.includes("Updating results"),
      ).length;

      capture.samples.push({
        elapsedMs: performance.now() - capture.startedAt,
        bars: bars.map((bar) => {
          const rect = bar.getBoundingClientRect();
          const style = getComputedStyle(bar);
          return {
            top: Math.round(rect.top * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
            position: style.position,
            display: style.display,
            visibility: style.visibility,
            animationName: getComputedStyle(bar, "::after").animationName,
          };
        }),
        updatingAnnouncements,
      });
      window.requestAnimationFrame(sample);
    };
    window.requestAnimationFrame(sample);
  });
}

async function clearSearchProgressSamples(page: Page): Promise<void> {
  await page.evaluate(() => {
    const capture = (
      window as Window & {
        __reefSearchProgressCapture?: { startedAt: number; samples: unknown[] };
      }
    ).__reefSearchProgressCapture;
    if (!capture) throw new Error("search progress sampler is missing");
    capture.startedAt = performance.now();
    capture.samples.length = 0;
  });
}

async function summarizeSearchProgress(
  page: Page,
): Promise<SearchProgressSummary> {
  const samples = await page.evaluate(() => {
    const capture = (
      window as Window & {
        __reefSearchProgressCapture?: {
          startedAt: number;
          samples: SearchProgressSample[];
        };
      }
    ).__reefSearchProgressCapture;
    if (!capture) throw new Error("search progress sampler is missing");
    return capture.samples;
  });
  const activeSamples = samples.filter(
    (sample) => sample.bars.length > 0 || sample.updatingAnnouncements > 0,
  );
  return {
    frames: samples.length,
    activeFrames: activeSamples.length,
    maxBars: Math.max(0, ...samples.map((sample) => sample.bars.length)),
    maxUpdatingAnnouncements: Math.max(
      0,
      ...samples.map((sample) => sample.updatingAnnouncements),
    ),
    activeBarTops: [
      ...new Set(
        activeSamples.flatMap((sample) => sample.bars.map((bar) => bar.top)),
      ),
    ].sort((a, b) => a - b),
    activeBarHeights: [
      ...new Set(
        activeSamples.flatMap((sample) => sample.bars.map((bar) => bar.height)),
      ),
    ].sort((a, b) => a - b),
    activeBarPositions: [
      ...new Set(
        activeSamples.flatMap((sample) =>
          sample.bars.map((bar) => bar.position),
        ),
      ),
    ].sort(),
    activeAnimationNames: [
      ...new Set(
        activeSamples.flatMap((sample) =>
          sample.bars.map((bar) => bar.animationName),
        ),
      ),
    ].sort(),
  };
}

async function persistEvidence(
  testInfo: TestInfo,
  name: string,
  body: Buffer | string,
  contentType: string,
): Promise<void> {
  const path = testInfo.outputPath(name);
  await writeFile(path, body);
  await testInfo.attach(name, { path, contentType });
}

async function holdIssueSearchResponse(
  page: Page,
  query: string,
): Promise<{ responseHeld: Promise<number>; release: () => void }> {
  let resolveResponseHeld!: (status: number) => void;
  let releaseResponse!: () => void;
  const responseHeld = new Promise<number>((resolve) => {
    resolveResponseHeld = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });

  await page.route(
    (url) =>
      url.pathname === "/api/issues" && url.searchParams.get("q") === query,
    async (route) => {
      const response = await route.fetch();
      resolveResponseHeld(response.status());
      await released;
      await route.fulfill({ response });
    },
  );
  return { responseHeld, release: releaseResponse };
}

async function delaySearchResponses(page: Page, ms = 700): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/issues" && url.searchParams.has("q"),
    async (route) => {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, ms));
      await route.fulfill({ response });
    },
  );
}

test.describe("Search progress hairline (REEF-369)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "demo_board");
  });

  test("⌘K search shows the hairline while in flight, then clears", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await delaySearchResponses(page);

    await page.keyboard.press("Control+K");
    const input = page.locator('[data-testid="global-search-input"]');
    await expect(input).toBeVisible();
    await input.fill("blocker");

    // In flight (debounce + delayed fetch): the hairline is shown.
    await expect(page.locator(HAIRLINE)).toBeVisible();
    // Once the response settles, it is removed (renders nothing when idle).
    await expect(page.locator(HAIRLINE)).toHaveCount(0);
  });

  test("issue-list search shows the hairline on refetch, then clears", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    // The hairline is wired into IssueListTable (and BacklogView); switch to the
    // List view so it is mounted, then let the initial load settle.
    await page.goto("/workspace/reef-e2e/issues?view=list&sort=priority");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible();
    await delaySearchResponses(page);

    await page.locator('[data-testid="search-input"]').fill("blocker");

    await expect(page.locator(HAIRLINE)).toBeVisible();
    await expect(page.locator(HAIRLINE)).toHaveCount(0);
  });

  test("empty search mount stays quiet and one progress track follows issue search through each view", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installSearchProgressSampler(page);
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=board&sort=rank");
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await expect(page.locator(HAIRLINE)).toHaveCount(0);
    await page.waitForTimeout(250);

    const initialSummary = await summarizeSearchProgress(page);
    await persistEvidence(
      testInfo,
      "empty-search-mount.png",
      await page.screenshot(),
      "image/png",
    );

    const views = [
      {
        name: "board",
        path: "/workspace/reef-e2e/issues?view=board&sort=priority",
        ready: '[data-testid="kanban-board"]',
      },
      {
        name: "list",
        path: "/workspace/reef-e2e/issues?view=list&sort=priority",
        ready: '[data-testid="issue-list-row"]',
      },
      {
        name: "backlog",
        path: "/workspace/reef-e2e/issues?scope=backlog&view=list&sort=priority",
        ready: '[data-testid="backlog-row"]',
      },
      {
        name: "timeline",
        path: "/workspace/reef-e2e/issues?view=timeline",
        ready: '[data-testid="timeline-grid"]',
      },
    ] as const;
    const observations: Array<{
      view: string;
      query: string;
      responseStatus: number;
      progress: SearchProgressSummary;
    }> = [];

    for (const view of views) {
      await page.goto(view.path);
      await page.locator(view.ready).first().waitFor({ state: "visible" });
      await expect(page.getByTestId("search-input")).toHaveValue("");

      const queries = [
        `zzzz-no-match-${view.name}`,
        `zzzz-refresh-${view.name}`,
      ];
      for (const [searchIndex, query] of queries.entries()) {
        const held = await holdIssueSearchResponse(page, query);
        await clearSearchProgressSamples(page);
        await page.getByTestId("search-input").fill(query);
        const responseStatus = await held.responseHeld;
        await page.waitForTimeout(700);
        const progress = await summarizeSearchProgress(page);
        observations.push({
          view: view.name,
          query,
          responseStatus,
          progress,
        });

        if (view.name === "list" && searchIndex === 0) {
          await persistEvidence(
            testInfo,
            "issue-search-in-flight.png",
            await page.screenshot(),
            "image/png",
          );
        }

        held.release();
        await expect(page.locator(HAIRLINE)).toHaveCount(0);
        await expect(
          page.locator(UPDATING_STATUS).filter({ hasText: "Updating results" }),
        ).toHaveCount(0);
      }
    }

    await persistEvidence(
      testInfo,
      "issue-search-progress-frames.json",
      Buffer.from(
        JSON.stringify(
          { initial: initialSummary, searches: observations },
          null,
          2,
        ),
      ),
      "application/json",
    );

    expect(initialSummary.maxBars).toBe(0);
    expect(initialSummary.maxUpdatingAnnouncements).toBe(0);
    expect(observations).toHaveLength(views.length * 2);
    expect(observations.every((entry) => entry.responseStatus === 200)).toBe(
      true,
    );
    expect(observations.every((entry) => entry.progress.activeFrames > 0)).toBe(
      true,
    );
    expect(observations.every((entry) => entry.progress.maxBars <= 1)).toBe(
      true,
    );
    expect(
      observations.every(
        (entry) => entry.progress.maxUpdatingAnnouncements <= 1,
      ),
    ).toBe(true);
    expect(
      observations.every((entry) => entry.progress.activeBarTops.length === 1),
    ).toBe(true);
  });

  test("Rank search keeps its local results feedback at the results edge without an API search", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installSearchProgressSampler(page);
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=board&sort=rank");
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await clearSearchProgressSamples(page);

    const qRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/issues" && url.searchParams.has("q")) {
        qRequests.push(url.searchParams.get("q") ?? "");
      }
    });
    await page.getByTestId("search-input").fill("local-rank-search");
    await expect(page).toHaveURL(/q=local-rank-search/);
    await expect(page.locator(HAIRLINE)).toHaveCount(0);

    const progress = await summarizeSearchProgress(page);
    await persistEvidence(
      testInfo,
      "rank-search-progress-frames.json",
      Buffer.from(JSON.stringify(progress, null, 2)),
      "application/json",
    );
    expect(qRequests).toEqual([]);
    expect(progress.activeFrames).toBeGreaterThan(0);
    expect(progress.maxBars).toBeLessThanOrEqual(1);
    expect(progress.maxUpdatingAnnouncements).toBeLessThanOrEqual(1);
    expect(progress.activeBarTops).toHaveLength(1);
  });

  test("an instant local facet filter never shows the hairline", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    // The status facet is a client-side, in-memory filter (no async load, no
    // `loading` prop), so opening its panel must not flash the search hairline
    // — REEF-369 AC4.
    await page.locator('[data-testid="status-dropdown-trigger"]').click();
    await expect(
      page.locator('[data-testid="status-option-todo"]'),
    ).toBeVisible();
    await expect(page.locator(HAIRLINE)).toHaveCount(0);
  });
});
