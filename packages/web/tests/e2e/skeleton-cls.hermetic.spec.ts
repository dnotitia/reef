import { type Page, expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

/**
 * Real-browser layout-stability check for the route skeletons (REEF-258).
 *
 * jsdom does not compute layout, so the *.Skeleton.test.tsx contracts can pin
 * class names but never the actual pixel jump. This spec loads each route in
 * Chromium and reads the browser's own Cumulative Layout Shift for the first
 * paint → skeleton → hydration → data-load sequence. A skeleton whose body is
 * shorter or shaped differently than the loaded content shoves content down when
 * it hydrates; that shows up here as a large CLS. The shared PageHeader's
 * `useHydrated` subtitle/actions pop-in is a tiny, in-scope-excluded shift, so a
 * "good" CLS budget (< 0.1, Google's Web Vitals threshold) is the bar.
 *
 * Keep this list aligned with routed surfaces that own route-level skeletons:
 * reports, My Work, Settings, and all Issues views. View-switch flicker is
 * covered separately in view-switching.hermetic; this spec covers hard
 * navigation / refresh hydration.
 */

/** Sum the document's layout-shift entries (excluding input-driven shifts). */
async function cumulativeLayoutShift(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let cls = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            // layout-shift entries expose `value` + `hadRecentInput`.
            const shift = entry as PerformanceEntry & {
              value: number;
              hadRecentInput: boolean;
            };
            if (!shift.hadRecentInput) cls += shift.value;
          }
        });
        observer.observe({ type: "layout-shift", buffered: true });
        // Let buffered entries flush, then report.
        setTimeout(() => {
          observer.disconnect();
          resolve(cls);
        }, 300);
      }),
  );
}

const CLS_BUDGET = 0.1;

test.describe("Route skeleton layout stability (REEF-258)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("reports: skeleton holds the page through hydration", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/reports");
    await expect(page.getByTestId("reports-page")).toBeVisible();
    expect(await cumulativeLayoutShift(page)).toBeLessThan(CLS_BUDGET);
  });

  test("my-work: skeleton holds the page through hydration", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/my-work");
    await expect(page.getByTestId("my-work-summary")).toBeVisible();
    expect(await cumulativeLayoutShift(page)).toBeLessThan(CLS_BUDGET);
  });

  test("settings workspace: skeleton holds the page through hydration", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/settings/workspace");
    await expect(page.getByTestId("settings-group-workspace")).toBeVisible();
    expect(await cumulativeLayoutShift(page)).toBeLessThan(CLS_BUDGET);
  });

  test("issues list: toolbar + table skeleton holds through hydration", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/issues?view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible();
    expect(await cumulativeLayoutShift(page)).toBeLessThan(CLS_BUDGET);
  });

  test("issues board: toolbar + board skeleton holds through hydration", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/issues?view=board");
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    expect(await cumulativeLayoutShift(page)).toBeLessThan(CLS_BUDGET);
  });

  test("issues timeline: toolbar + timeline skeleton holds through hydration", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/issues?view=timeline");
    await expect(page.getByTestId("timeline-grid")).toBeVisible();
    expect(await cumulativeLayoutShift(page)).toBeLessThan(CLS_BUDGET);
  });

  test("issues backlog: toolbar + backlog skeleton holds through hydration", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/issues?view=backlog");
    await expect(page.getByTestId("backlog-header")).toBeVisible();
    expect(await cumulativeLayoutShift(page)).toBeLessThan(CLS_BUDGET);
  });
});
