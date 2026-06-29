import { type Page, expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

/**
 * Issue view-switch interaction (REEF-265). The Board / List / Timeline /
 * Backlog tabs are peer renderings of one cached collection, so switching is a
 * pure render/nav swap. The fix wraps the ViewSwitcher navigation in a React
 * transition so the route `loading.tsx` board skeleton no longer flashes and
 * the current view stays mounted while the next renders. These run against the
 * real reef-web runtime (not jsdom) because the transition's fallback
 * suppression only shows up in a browser.
 */

const VIEW_BODY: Record<string, string> = {
  board: "kanban-board",
  list: "issue-list-row",
  timeline: "timeline-grid",
  backlog: "backlog-header",
};

async function switchTo(
  page: Page,
  view: keyof typeof VIEW_BODY,
): Promise<void> {
  await page.locator(`[data-testid="view-switcher-${view}"]`).click();
  await page.waitForURL(new RegExp(`view=${view}`), { timeout: 10_000 });
  await expect(
    page.locator(`[data-testid="${VIEW_BODY[view]}"]`).first(),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe("Hermetic issue view switching", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("swaps views and keeps ?view= in sync without flashing the board skeleton", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/issues");
    await expect(
      page.locator('[data-testid="kanban-board"]').first(),
    ).toBeVisible({ timeout: 15_000 });

    // Record any appearance of the route loading skeleton across the soft-nav
    // switches. App Router soft navigation keeps the same document, so this
    // observer (installed after the initial board paint) survives every tab
    // switch below and would latch true if the skeleton flashed.
    await page.evaluate(() => {
      const w = window as unknown as {
        __skeletonSeen: boolean;
        __skeletonObs?: MutationObserver;
      };
      w.__skeletonSeen = false;
      const check = () => {
        if (document.querySelector('[data-testid="issues-skeleton"]')) {
          w.__skeletonSeen = true;
        }
      };
      check();
      const obs = new MutationObserver(check);
      obs.observe(document.body, { childList: true, subtree: true });
      w.__skeletonObs = obs;
    });

    await switchTo(page, "list");
    await switchTo(page, "timeline");
    await switchTo(page, "backlog");
    await switchTo(page, "board");

    const skeletonSeen = await page.evaluate(
      () => (window as unknown as { __skeletonSeen: boolean }).__skeletonSeen,
    );
    expect(skeletonSeen).toBe(false);

    // The switcher group carries its busy state for assistive tech (AC2).
    await expect(page.locator('[data-testid="view-switcher"]')).toHaveAttribute(
      "aria-busy",
      /true|false/,
    );
  });

  test("rapid consecutive clicks converge to the last selected view", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/issues");
    await expect(
      page.locator('[data-testid="kanban-board"]').first(),
    ).toBeVisible({ timeout: 15_000 });

    // Fire three switches back-to-back without awaiting navigation between them;
    // the interruptible transition must settle on the last choice (Backlog).
    await page.locator('[data-testid="view-switcher-list"]').click();
    await page.locator('[data-testid="view-switcher-timeline"]').click();
    await page.locator('[data-testid="view-switcher-backlog"]').click();

    await page.waitForURL(/view=backlog/, { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="backlog-header"]').first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
