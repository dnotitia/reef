import { expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "../harness/fixture";

const splitter = '[data-testid="issue-detail-resize-handle"]';
const expandWidthName = "Expand issue detail panel to maximum width";
const restoreWidthName = "Restore issue detail panel width";

test.describe("Hermetic issue detail splitter", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("supports pointer and keyboard resize, then restores the width after issue navigation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");
    await page.getByText("Initial issue Alpha").click();
    await page.waitForURL(/\/issues\/REEF-001\?view=list/, {
      timeout: 10_000,
    });

    const handle = page.locator(splitter);
    await expect(handle).toBeVisible();
    await expect(handle).toHaveAttribute("role", "separator");
    await expect(handle).toHaveAttribute("aria-orientation", "vertical");
    await expect(handle).toHaveAttribute("aria-valuemin", "960");
    await expect(handle).toHaveAttribute("aria-valuenow", "1200");
    await expect(handle).toHaveAttribute("aria-valuetext", "1200px");
    await expect(handle).toHaveAttribute("aria-controls", "issue-detail-panel");
    await expect(handle).toHaveAttribute(
      "aria-describedby",
      "issue-detail-resize-description",
    );
    await expect(page.locator("#issue-detail-panel")).toHaveAttribute(
      "role",
      "region",
    );
    await expect(
      page.locator("#issue-detail-resize-description"),
    ).toContainText(
      "Vertical separator controls the issue detail panel. Current width 1200px; minimum 960px; maximum 1353.6px.",
    );

    const widthToggle = page.getByRole("button", { name: expandWidthName });
    await expect(widthToggle).toHaveAttribute("aria-pressed", "false");
    await widthToggle.click();
    await expect(
      page.getByRole("button", { name: restoreWidthName }),
    ).toHaveAttribute("aria-pressed", "true");
    const expandedGeometry = await page
      .locator('[data-slot="sheet-content"]')
      .evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
    expect(expandedGeometry).toBeCloseTo(1440 * 0.94, 1);
    await page.getByRole("button", { name: restoreWidthName }).click();
    await expect(widthToggle).toHaveAttribute("aria-pressed", "false");
    await expect(handle).toHaveAttribute("aria-valuenow", "1200");

    const box = await handle.boundingBox();
    if (!box) throw new Error("Splitter is not laid out");
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x - 96, box.y + 40, {
      steps: 4,
    });
    await page.mouse.up();

    const draggedWidth = Number(await handle.getAttribute("aria-valuenow"));
    expect(draggedWidth).toBeGreaterThan(1200);
    expect(draggedWidth).toBeLessThanOrEqual(1440 * 0.94);

    await handle.focus();
    await page.keyboard.press("ArrowRight");
    await expect(handle).toHaveAttribute(
      "aria-valuenow",
      String(draggedWidth - 32),
    );
    await expect(handle).toHaveAttribute(
      "aria-valuetext",
      `${draggedWidth - 32}px`,
    );
    await page.keyboard.press("Home");
    await expect(handle).toHaveAttribute("aria-valuenow", "960");
    await page.keyboard.press("End");
    await expect(handle).toHaveAttribute("aria-valuenow", "1353.6");

    await page.getByRole("button", { name: expandWidthName }).click();
    await expect(
      page.getByRole("button", { name: restoreWidthName }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "1321.6");
    await expect(
      page.getByRole("button", { name: expandWidthName }),
    ).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("End");
    await expect(handle).toHaveAttribute("aria-valuenow", "1353.6");
    await page.getByRole("button", { name: expandWidthName }).click();
    const expandedHandleBox = await handle.boundingBox();
    if (!expandedHandleBox)
      throw new Error("Expanded splitter is not laid out");
    await page.mouse.move(
      expandedHandleBox.x + expandedHandleBox.width / 2,
      expandedHandleBox.y + 40,
    );
    await page.mouse.down();
    await page.mouse.move(
      expandedHandleBox.x + expandedHandleBox.width / 2 + 40,
      expandedHandleBox.y + 40,
      { steps: 2 },
    );
    await page.mouse.up();
    await expect(handle).toHaveAttribute("aria-valuenow", "1313.6");
    await expect(
      page.getByRole("button", { name: expandWidthName }),
    ).toHaveAttribute("aria-pressed", "false");
    await handle.focus();
    await page.keyboard.press("End");
    await expect(handle).toHaveAttribute("aria-valuenow", "1353.6");

    const geometry = await page
      .locator("#issue-detail-panel")
      .evaluate((el) => {
        const panel = el as HTMLElement;
        return {
          panelOverflow: panel.scrollWidth > panel.clientWidth,
          documentOverflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        };
      });
    expect(geometry.panelOverflow).toBe(false);
    expect(geometry.documentOverflow).toBe(false);

    await page.getByTestId("issue-close").click();
    await page.waitForURL(/\/issues\?view=list$/, { timeout: 10_000 });
    await page.getByText("Initial issue Beta").click();
    await page.waitForURL(/\/issues\/REEF-002\?view=list/, {
      timeout: 10_000,
    });
    await expect(page.locator(splitter)).toHaveAttribute(
      "aria-valuenow",
      "1353.6",
    );
  });

  test("keeps the existing responsive detail layout without a splitter", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1279, height: 900 });
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await expect(page.locator(splitter)).toHaveCount(0);
    await expect(page.getByTestId("issue-detail-width-toggle")).toHaveCount(0);

    const narrowGeometry = await page
      .locator("#issue-detail-panel")
      .evaluate((el) => {
        const panel = el as HTMLElement;
        return {
          width: panel.getBoundingClientRect().width,
          documentOverflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        };
      });
    expect(narrowGeometry.width).toBeLessThanOrEqual(1200);
    expect(narrowGeometry.documentOverflow).toBe(false);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(splitter)).toHaveCount(0);
    await expect(page.getByTestId("issue-close")).toBeVisible();
    await expect(page.getByTestId("issue-detail-sidebar")).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  });
});
