import { expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "../harness/fixture";

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
    await page.goto("/workspace/reef-e2e/my-work");

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
    await page.goto("/workspace/reef-e2e/my-work");
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
    await page.goto("/workspace/reef-e2e/my-work");

    const firstRow = page.locator('[data-testid^="my-work-row-"]').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    await page.waitForURL(/\/issues\/REEF-/, { timeout: 10_000 });
  });

  test("keeps populated rows readable and contained at the supported widths", async ({
    page,
    request,
  }, testInfo) => {
    await resetFixture(request, "demo_board");
    await openExistingWorkspace(page);

    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/workspace/reef-e2e/my-work");

      const queue = page.getByTestId("my-work-queue");
      await expect(queue).toBeVisible();
      const rows = page.locator('[data-testid^="my-work-row-REEF-"]');
      await expect(rows.first()).toBeVisible();

      const geometry = await page.evaluate(() => {
        const rowElements = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-testid^="my-work-row-REEF-"]',
          ),
        );
        const main = document.querySelector<HTMLElement>("main");
        return {
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          viewportWidth: window.innerWidth,
          main: main
            ? {
                clientWidth: main.clientWidth,
                left: main.getBoundingClientRect().left,
                right: main.getBoundingClientRect().right,
              }
            : null,
          rows: rowElements.map((row) => ({
            clientWidth: row.clientWidth,
            scrollWidth: row.scrollWidth,
            left: row.getBoundingClientRect().left,
            right: row.getBoundingClientRect().right,
            title: row.querySelector<HTMLElement>(
              '[data-testid="my-work-row-title"]',
            )?.textContent,
          })),
        };
      });
      expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.documentWidth).toBeLessThanOrEqual(
        geometry.viewportWidth,
      );
      expect(geometry.main).not.toBeNull();
      expect(geometry.main?.left).toBeGreaterThanOrEqual(0);
      expect(geometry.main?.right).toBeLessThanOrEqual(geometry.viewportWidth);
      for (const row of geometry.rows) {
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
        expect(row.left).toBeGreaterThanOrEqual(geometry.main?.left ?? 0);
        expect(row.right).toBeLessThanOrEqual(geometry.main?.right ?? width);
        expect(row.title?.trim()).not.toBe("");
      }

      const firstRow = rows.first();
      await expect(firstRow.getByTestId("my-work-row-identity")).toBeVisible();
      await expect(firstRow.getByTestId("my-work-row-title")).toHaveAttribute(
        "title",
        /.+/,
      );
      await expect(firstRow.getByTestId("my-work-row-meta")).toBeVisible();

      const blockedRow = rows.filter({ hasText: "Blocked" }).first();
      await expect(blockedRow).toBeVisible();
      await expect(blockedRow.getByText(/Blocked/)).toBeVisible();
      const dueRow = rows
        .filter({ has: page.locator('[data-testid="my-work-row-meta"]') })
        .first();
      await expect(dueRow).toBeVisible();
      await expect(dueRow.getByTestId("my-work-row-meta")).toContainText(
        /\d{2}-\d{2}/,
      );

      const screenshot = await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`my-work-${width}.png`),
      });
      expect(screenshot.byteLength).toBeGreaterThan(0);
    }
  });
});
