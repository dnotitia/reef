import { test } from "../harness/workspace-fixture";
import { type Page, expect } from "@playwright/test";

/**
 * Issue view-switch interaction (REEF-265). Scope and layout are independent
 * controls over one cached collection, so switching is a
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

async function holdListNavigation(page: Page) {
  let admitted = false;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Hold the real Next RSC response, preserving its bytes and Reef API calls.
  await page.route(
    (url) =>
      url.pathname === "/workspace/reef-e2e/issues" &&
      url.searchParams.get("view") === "list" &&
      url.searchParams.has("_rsc"),
    async (route) => {
      const response = await route.fetch();
      admitted = true;
      await gate;
      await route.fulfill({ response });
    },
  );
  return { wait: () => expect.poll(() => admitted).toBe(true), release };
}

test.describe("Hermetic issue view switching", () => {
  test.use({ scenario: "configured" });

  test("swaps layouts and keeps the independent URL state without flashing the board skeleton", async ({
    openWorkspace,
    page,
  }) => {
    await openWorkspace();

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

    const held = await holdListNavigation(page);
    await page.getByTestId("view-switcher-list").click({ noWaitAfter: true });
    await held.wait();
    await expect(page.getByTestId("view-switcher")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await expect(page.getByTestId("issues-skeleton")).toHaveCount(0);
    held.release();
    await expect(page.getByTestId("issue-list-row").first()).toBeVisible();
    await expect(page.getByTestId("view-switcher")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await switchTo(page, "timeline");
    await page.locator('[data-testid="scope-switcher-backlog"]').click();
    await page.waitForURL(/scope=backlog&view=list/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="backlog-table"]')).toBeVisible();
    await page.locator('[data-testid="scope-switcher-active"]').click();
    await page.waitForURL(/scope=active&view=list/, { timeout: 10_000 });
    await switchTo(page, "board");

    const skeletonSeen = await page.evaluate(
      () => (window as unknown as { __skeletonSeen: boolean }).__skeletonSeen,
    );
    expect(skeletonSeen).toBe(false);

    // The switcher group carries its busy state for assistive tech (AC2).
    await expect(page.locator('[data-testid="view-switcher"]')).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  test("rapid consecutive clicks converge to the last selected view", async ({
    openWorkspace,
    page,
  }) => {
    await openWorkspace();

    await page.goto("/workspace/reef-e2e/issues");
    await expect(
      page.locator('[data-testid="kanban-board"]').first(),
    ).toBeVisible({ timeout: 15_000 });

    const held = await holdListNavigation(page);
    await page.getByTestId("view-switcher-list").click({ noWaitAfter: true });
    await held.wait();
    await expect(page.getByTestId("view-switcher")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await page
      .getByTestId("view-switcher-timeline")
      .click({ noWaitAfter: true });
    await page
      .getByTestId("scope-switcher-backlog")
      .click({ noWaitAfter: true });
    held.release();

    await page.waitForURL(/scope=backlog&view=list/, { timeout: 10_000 });
    await expect(page.getByTestId("backlog-table")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("scope-switcher-backlog")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("view-switcher-list")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("view-switcher")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });
});
