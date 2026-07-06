import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "./harness/fixture";

function reefVault(
  state: Awaited<ReturnType<typeof readFixtureState>>,
): Awaited<ReturnType<typeof readFixtureState>>["vaults"][number] {
  const vault = state.vaults.find(
    (candidate) => candidate.name === REEF_E2E_VAULT,
  );
  if (!vault) throw new Error(`Missing fixture vault: ${REEF_E2E_VAULT}`);
  return vault;
}

test.describe("Hermetic similar issue hints", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("shows advisory similar issues while drafting without blocking create", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");

    await page.locator('[data-testid="new-issue-trigger"]').click();
    await expect(
      page.locator('[data-testid="new-issue-dialog"]'),
    ).toBeVisible();

    await page
      .locator('[data-testid="new-issue-title-input"]')
      .fill("Initial issue Alpha duplicate");

    const section = page.locator('[data-testid="similar-issues-section"]');
    await expect(section).toBeVisible();
    const rows = section.locator('[data-testid="similar-issue-row"]');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toHaveText(/REEF-001.*Initial issue Alpha/);

    const popupPromise = page.waitForEvent("popup");
    await section.getByRole("link", { name: /REEF-001/ }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/\/workspace\/reef-e2e\/issues\/REEF-001$/);
    await popup.close();

    await section.getByRole("button", { name: "Hide similar issues" }).click();
    await expect(
      page.locator('[data-testid="similar-issues-section"]'),
    ).toHaveCount(0);

    await page.locator('[data-testid="new-issue-submit"]').click();
    await page.waitForURL(/\/issues\/REEF-004/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Initial issue Alpha duplicate",
    );
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return reefVault(state).issue_ids;
      })
      .toContain("REEF-004");
  });
});
