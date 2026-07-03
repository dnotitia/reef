import { type Page, expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

// UI-only timing: these tests assert a purely visual in-flight indicator — the
// shared SearchProgressBar hairline (REEF-369). reef-web's real /api/issues
// route still handles every request (route.continue keeps the payload
// untouched); page.route only DELAYS the search responses so the brief
// in-flight window is observable instead of racing to zero. This is the
// documented UI-only exception to the "don't page.route reef's own /api/*"
// rule — the timing, not the behavior, is what's stubbed.

const HAIRLINE = '[data-testid="search-progress-bar"]';

async function delaySearchResponses(page: Page, ms = 700): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/issues" && url.searchParams.has("q"),
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await route.continue();
    },
  );
}

test.describe("Search progress hairline (REEF-369)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("⌘K search shows the hairline while in flight, then clears", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await delaySearchResponses(page);

    await page.keyboard.press("Control+KeyK");
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
    await page.locator('[data-testid="view-switcher-list"]').click();
    await expect(page.locator('[data-testid="issue-list-row"]').first()).toBeVisible();
    await delaySearchResponses(page);

    await page.locator('[data-testid="search-input"]').fill("blocker");

    await expect(page.locator(HAIRLINE)).toBeVisible();
    await expect(page.locator(HAIRLINE)).toHaveCount(0);
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
