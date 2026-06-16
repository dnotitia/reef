import { expect, test } from "@playwright/test";
import {
  readFixtureState,
  resetFixture,
  signInAsAlice,
} from "./harness/fixture";

test.describe("Hermetic onboarding flow", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "empty");
  });

  test("creates a reef workspace through real Route Handlers", async ({
    page,
    request,
  }) => {
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    await page
      .locator('[data-testid="greenfield-vault-name-input"]')
      .fill("reef-new");
    await expect(
      page.locator('[data-testid="greenfield-project-prefix-input"]'),
    ).toHaveValue("REEF");
    await page.locator('[data-testid="greenfield-create-btn"]').click();

    await page.waitForURL(/\/issues\/?$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
    await expect(page.getByTestId("sidebar-workspace-trigger")).toContainText(
      "reef-new",
    );

    const state = await readFixtureState(request);
    const created = state.vaults.find((vault) => vault.name === "reef-new");
    expect(created?.settings.project_prefix).toBe("REEF");
    expect(created?.tables).toContain("reef_issues");
    expect(
      state.calls.some(
        (call) =>
          call.method === "POST" &&
          call.path === "/akb/api/v1/tables/reef-new/sql",
      ),
    ).toBe(true);
  });

  test("shows the existing-workspace empty state when no vault has reef config", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "raw_only");
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    await page.getByText("Use an existing reef workspace").click();

    await expect(
      page.locator('[data-testid="onboarding-empty-state"]'),
    ).toContainText(/No existing reef workspaces found/i);
    await expect(
      page.locator('[data-testid="onboarding-continue-btn"]'),
    ).toBeDisabled();
  });
});
