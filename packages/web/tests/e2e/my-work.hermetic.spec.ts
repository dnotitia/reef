import { expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

/**
 * Hermetic coverage for the personal My Work view (REEF-181). The page is
 * reachable by URL (its sidebar entry ships in REEF-204); these exercise the
 * auto-scoped summary + queue, the by-status grouping, and opening an issue.
 */
test.describe("Hermetic My Work flow", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("renders the auto-scoped summary and focus queue", async ({ page }) => {
    await openExistingWorkspace(page);
    await page.goto("/my-work");

    // Summary strip (no scope picker — auto-scoped to the signed-in user).
    await expect(page.getByTestId("my-work-summary")).toBeVisible();
    await expect(page.getByTestId("my-work-tile-wip")).toBeVisible();
    await expect(page.getByTestId("my-work-tile-overdue")).toBeVisible();
    await expect(page.getByTestId("my-work-stagebar")).toBeVisible();

    // The queue has at least one row (alice owns fixture work).
    await expect(page.getByTestId("my-work-queue")).toBeVisible();
    await expect(
      page.locator('[data-testid^="my-work-row-"]').first(),
    ).toBeVisible();
  });

  test("groups by status and writes the mode to the URL", async ({ page }) => {
    await openExistingWorkspace(page);
    await page.goto("/my-work");
    await expect(page.getByTestId("my-work-queue")).toBeVisible();

    await page.getByTestId("my-work-group-status").click();
    await page.waitForURL(/group=status/, { timeout: 10_000 });
    await expect(page.getByTestId("my-work-group-status")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // At least one status section header is now rendered.
    await expect(
      page.locator('[data-testid^="my-work-group-header-"]').first(),
    ).toBeVisible();
  });

  test("opens an issue from the queue", async ({ page }) => {
    await openExistingWorkspace(page);
    await page.goto("/my-work");

    const firstRow = page.locator('[data-testid^="my-work-row-"]').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    await page.waitForURL(/\/issues\/REEF-/, { timeout: 10_000 });
  });
});
