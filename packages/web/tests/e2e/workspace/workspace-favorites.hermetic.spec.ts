import { expect, test } from "@playwright/test";
import {
  openExistingWorkspace,
  readIndexedDbConfig,
  resetFixture,
} from "../harness/fixture";

const FAVORITES_KEY = "workspace_favorites";

test.describe("Hermetic workspace favorites", () => {
  test.beforeEach(async ({ request }) => {
    await resetFixture(request, "configured_multi");
  });

  test("groups, searches, navigates, restores, and cleans up browser-local favorites", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    const trigger = page.getByTestId("sidebar-workspace-trigger");
    await trigger.click();
    const switcher = page.getByTestId("workspace-switcher");
    const search = page.getByTestId("workspace-switcher-search");
    await search.fill("reef");

    const alphaFavorite = page.getByTestId(
      "workspace-switcher-favorite-reef-alpha",
    );
    await expect(alphaFavorite).toHaveAttribute("aria-pressed", "false");
    await expect(alphaFavorite).toHaveAccessibleName(
      "Add reef-alpha to favorites",
    );
    await alphaFavorite.click();

    await expect(alphaFavorite).toHaveAttribute("aria-pressed", "true");
    await expect(search).toHaveValue("reef");
    await expect(switcher).toBeVisible();
    await expect(
      switcher.getByRole("heading", { name: "Favorites" }),
    ).toBeVisible();
    await expect(
      switcher
        .getByTestId("workspace-switcher-other")
        .getByTestId("workspace-switcher-option-reef-alpha"),
    ).toHaveCount(0);
    await expect
      .poll(() => readIndexedDbConfig(page, FAVORITES_KEY))
      .toBe(JSON.stringify({ version: 1, favorites: ["reef-alpha"] }));

    // Search remains active while another workspace is favorited, and toggles
    // never change the current URL or close the popover.
    const zetaFavorite = page.getByTestId(
      "workspace-switcher-favorite-reef-zeta",
    );
    await zetaFavorite.click();
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/?$/);
    await expect(search).toHaveValue("reef");
    await expect(zetaFavorite).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => readIndexedDbConfig(page, FAVORITES_KEY))
      .toBe(
        JSON.stringify({
          version: 1,
          favorites: ["reef-alpha", "reef-zeta"],
        }),
      );

    // Escape closes the same popover and restores focus to its trigger.
    await page.keyboard.press("Escape");
    await expect(switcher).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Selecting the workspace name, rather than its star, owns navigation.
    await trigger.click();
    await page.getByTestId("workspace-switcher-option-reef-alpha").click();
    await expect(page).toHaveURL(/\/workspace\/reef-alpha\/issues\/?$/);

    // The same browser context restores the preference after a real reload.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
    await page.getByTestId("sidebar-workspace-trigger").click();
    const restoredAlphaFavorite = page.getByTestId(
      "workspace-switcher-favorite-reef-alpha",
    );
    await expect(restoredAlphaFavorite).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByTestId("workspace-switcher-option-raw-vault"),
    ).toHaveCount(0);

    // Space activates the independent toggle and does not change the URL.
    await restoredAlphaFavorite.focus();
    await page.keyboard.press("Space");
    await expect(restoredAlphaFavorite).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page).toHaveURL(/\/workspace\/reef-alpha\/issues\/?$/);
    await expect(
      page
        .getByTestId("workspace-switcher-other")
        .getByTestId("workspace-switcher-option-reef-alpha"),
    ).toBeVisible();

    // Sign-out uses the existing account cleanup boundary and removes the
    // account-scoped favorite key while leaving the browser context usable.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login\/?$/, { timeout: 10_000 });
    await expect
      .poll(() => readIndexedDbConfig(page, FAVORITES_KEY))
      .toBeUndefined();
  });
});
