import { expect, test } from "@playwright/test";
import {
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  resetFixture,
} from "./harness/fixture";

// REEF-313: the workspace AI-scanning switch is a team-shared config setting,
// so toggling it in Settings must round-trip through the real PATCH /api/config
// route and gate the Activity feed's manual scan affordance for the workspace.
test.describe("Hermetic AI activity scanning toggle (REEF-313)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("toggles the workspace scanning switch and gates the activity scan affordance through real config routes", async ({
    page,
  }) => {
    // Drop the persisted React Query snapshot on each navigation so /activity
    // re-reads ['config', vault] fresh after each settings write (mirrors the
    // monitored-repos spec's staleTime guard).
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);

    // The configured hermetic workspace starts with scanning on.
    await page.goto("/workspace/reef-e2e/settings/workspace");
    const main = page.getByRole("main");
    await expect(main.getByTestId("activity-scanning-toggle")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // While on, the Activity feed exposes the manual Refresh control.
    await page.goto("/workspace/reef-e2e/activity");
    await expect(page.getByTestId("activity-refresh")).toBeVisible();
    await expect(page.getByTestId("activity-scanning-off")).toHaveCount(0);

    // Turn scanning off — persisted through the real PATCH /api/config.
    await page.goto("/workspace/reef-e2e/settings/workspace");
    await main.getByTestId("activity-scanning-toggle").click();
    await expect(main.getByTestId("activity-scanning-toggle")).toHaveAttribute(
      "aria-checked",
      "false",
    );

    // The Activity feed now hides the manual scan and shows the off note.
    await page.goto("/workspace/reef-e2e/activity");
    await expect(page.getByTestId("activity-scanning-off")).toBeVisible();
    await expect(page.getByTestId("activity-refresh")).toHaveCount(0);

    // Turn it back on; the affordance returns.
    await page.goto("/workspace/reef-e2e/settings/workspace");
    await main.getByTestId("activity-scanning-toggle").click();
    await expect(main.getByTestId("activity-scanning-toggle")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.goto("/workspace/reef-e2e/activity");
    await expect(page.getByTestId("activity-refresh")).toBeVisible();
  });
});
