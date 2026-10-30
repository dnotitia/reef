import { test } from "../harness/workspace-fixture";
import { expect } from "@playwright/test";
import { readFixtureState } from "../harness/fixture";

const LONG_MILESTONE_NAME =
  "A milestone name long enough to overflow the planning filter option panel";
const ADJACENT_MILESTONE_NAME = "Adjacent milestone";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "narrow", width: 390, height: 844 },
] as const;

test.describe("Planning overflow tooltip pointer contract", () => {
  test.use({ scenario: "planning_overflow" });

  for (const viewport of VIEWPORTS) {
    test(`moves from an overflowing milestone to its adjacent option at ${viewport.name} size`, async ({
      openWorkspace,
      page,
      request,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await openWorkspace();
      await page.goto("/workspace/reef-e2e/issues?view=list");
      await expect(
        page.locator('[data-testid="issue-list-row"]').first(),
      ).toBeVisible({ timeout: 15_000 });

      const fixture = await readFixtureState(request);
      const vault = fixture.vaults.find((item) => item.name === "reef-e2e");
      const adjacentMilestone = vault?.milestones.find(
        (item) => item.name === ADJACENT_MILESTONE_NAME,
      );
      expect(adjacentMilestone).toBeDefined();

      await page.getByTestId("milestone-dropdown-trigger").click();
      const list = page.getByRole("listbox");
      const longOption = list.getByRole("option", {
        name: new RegExp(LONG_MILESTONE_NAME),
      });
      const adjacentOption = list.getByRole("option", {
        name: new RegExp(ADJACENT_MILESTONE_NAME),
      });
      const longText = longOption.locator("span.flex-1.truncate");

      await expect
        .poll(async () =>
          longText.evaluate(
            (element) => element.scrollWidth > element.clientWidth,
          ),
        )
        .toBe(true);

      await longOption.hover();
      await expect(page.getByRole("tooltip")).toHaveText(LONG_MILESTONE_NAME);
      await expect(longOption).toHaveAttribute("data-selected", "true");
      const tooltipWrapper = page.locator(
        '[data-radix-popper-content-wrapper]:has([data-reef-tooltip-content="true"])',
      );
      await expect(tooltipWrapper).toHaveCount(1);
      await expect(tooltipWrapper).toHaveCSS("pointer-events", "none");

      await adjacentOption.hover();
      await expect(adjacentOption).toHaveAttribute("data-selected", "true");
      await expect(longOption).toHaveAttribute("data-selected", "false");
      await expect(page.getByRole("tooltip")).toHaveCount(0);

      await adjacentOption.click();
      await expect(page).toHaveURL(/milestone_id=/);
      await expect
        .poll(() => new URL(page.url()).searchParams.get("milestone_id"))
        .toBe(adjacentMilestone?.id);
      await page.keyboard.press("Escape");
      await expect(
        page.getByTestId("milestone-dropdown-trigger"),
      ).toContainText(ADJACENT_MILESTONE_NAME);
      await expect(
        page.getByRole("button", { name: "Clear Milestone filter" }),
      ).toBeVisible();
    });
  }
});
