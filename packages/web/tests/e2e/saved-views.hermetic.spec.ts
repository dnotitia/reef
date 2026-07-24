import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  dropFixtureTable,
  openExistingWorkspace,
  readFixtureState,
  readIndexedDbConfig,
  resetFixture,
} from "./harness/fixture";

const DEFAULT_POINTER_KEY = `default_issue_view:${REEF_E2E_VAULT}`;
const FAVORITES_KEY = `favorite_issue_views:${REEF_E2E_VAULT}`;

test.describe("Hermetic saved issue views", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("manages team views, personal favorites, active context, defaults, and deletion", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues");
    await expect(page.getByRole("button", { name: "Save view" })).toHaveCount(
      0,
    );
    await page.goto(
      "/workspace/reef-e2e/issues?status=todo&q=Alpha&sort=priority&order=desc&view=list",
    );
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({ timeout: 15_000 });

    const saveButton = page.getByRole("button", { name: "Save view" });
    await expect(saveButton).toBeVisible();
    await saveButton.click();
    const saveDialog = page.getByTestId("save-view-dialog");
    const nameInput = saveDialog.getByLabel("View name");
    await expect(nameInput).toBeFocused();
    await nameInput.fill("Alpha todo");
    await saveDialog.getByRole("button", { name: "Save view" }).click();

    // Saving creates a shared team view but never favorites it implicitly.
    await expect(page.getByTestId("favorite-views-nav")).toHaveCount(0);
    await expect
      .poll(() => readIndexedDbConfig(page, FAVORITES_KEY))
      .toBeUndefined();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("q"))
      .toBe("Alpha");
    await expect(
      page.getByRole("button", { name: "Alpha todo, Active" }),
    ).toBeVisible();

    // The top-level Views surface owns discovery and management of every team
    // view. Adding a personal Favorite explicitly creates the sidebar shortcut.
    await page.getByRole("link", { name: "Views" }).click();
    await page.waitForURL("/workspace/reef-e2e/views");
    const viewsList = page.getByTestId("saved-views-list");
    const teamViewLink = viewsList.getByRole("link", { name: "Alpha todo" });
    await expect(teamViewLink).toHaveAttribute(
      "href",
      /\/workspace\/reef-e2e\/issues\?order=desc&q=Alpha&sort=priority&status=todo&view=list&saved_view=[0-9a-f-]{36}$/,
    );
    await expect(viewsList.getByText("Owner: alice")).toBeVisible();
    await viewsList
      .getByRole("button", { name: "Actions for Alpha todo" })
      .click();
    await page.getByRole("menuitem", { name: "Add to Favorites" }).click();

    const favorites = page.getByTestId("favorite-views-nav");
    const favoriteLink = favorites.getByRole("link", { name: "Alpha todo" });
    await expect(favoriteLink).toBeVisible();
    await expect
      .poll(() => readIndexedDbConfig(page, FAVORITES_KEY))
      .toMatch(/"version":1.*"ids":\["[0-9a-f-]{36}"\]/);

    await favoriteLink.click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("saved_view"))
      .toMatch(/^[0-9a-f-]{36}$/);
    await expect
      .poll(() => {
        const params = new URL(page.url()).searchParams;
        params.delete("saved_view");
        return Object.fromEntries(params.entries());
      })
      .toEqual({
        order: "desc",
        q: "Alpha",
        sort: "priority",
        status: "todo",
        view: "list",
      });
    await expect(favoriteLink).toHaveAttribute("aria-current", "page");
    await expect(page.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Alpha todo, Active" }),
    ).toBeVisible();

    // Editing the ordinary Issues filter keeps the originating named view as
    // context, but marks it changed until the user explicitly updates it.
    await page.getByTestId("priority-dropdown-trigger").click();
    await page.getByTestId("priority-option-high").click();
    const changedControl = page.getByRole("button", {
      name: "Alpha todo, Changed",
    });
    await expect(changedControl).toBeVisible();
    await changedControl.click();
    await page
      .getByRole("menuitem", { name: "Update with current view" })
      .click();
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults[0]?.saved_views[0]?.payload;
      })
      .toEqual({
        version: 1,
        query: {
          order: ["desc"],
          priority: ["high"],
          q: ["Alpha"],
          sort: ["priority"],
          status: ["todo"],
          view: ["list"],
        },
      });
    await expect(
      page.getByRole("button", { name: "Alpha todo, Active" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Alpha todo, Active" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const renameDialog = page.getByRole("dialog", { name: "Rename" });
    await renameDialog.getByLabel("View name").fill("High priority");
    await renameDialog.getByRole("button", { name: "Save" }).click();
    const renamedFavorite = favorites.getByRole("link", {
      name: "High priority",
    });
    await expect(renamedFavorite).toBeVisible();

    // Favorite and default are independent personal pointers. Removing the
    // shortcut does not remove the shared team view.
    await page.getByRole("link", { name: "Views" }).click();
    await page.waitForURL("/workspace/reef-e2e/views");
    const renamedTeamView = viewsList.getByRole("link", {
      name: "High priority",
    });
    await expect(renamedTeamView).toBeVisible();
    await viewsList
      .getByRole("button", { name: "Actions for High priority" })
      .click();
    await page.getByRole("menuitem", { name: "Remove from Favorites" }).click();
    await expect(page.getByTestId("favorite-views-nav")).toHaveCount(0);
    await expect(renamedTeamView).toBeVisible();

    await viewsList
      .getByRole("button", { name: "Actions for High priority" })
      .click();
    await page.getByRole("menuitem", { name: "Set as default" }).click();
    await expect(viewsList.getByText("Default view")).toBeVisible();
    await expect
      .poll(() => readIndexedDbConfig(page, DEFAULT_POINTER_KEY))
      .toMatch(/^[0-9a-f-]{36}$/);
    await expect
      .poll(() => readIndexedDbConfig(page, FAVORITES_KEY))
      .toBe('{"version":1,"ids":[]}');

    // A fresh same-vault bare Issues mount must re-evaluate the named default
    // without restoring the removed Favorite shortcut.
    await page.goto("/workspace/reef-e2e/issues?status=todo&view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("q"))
      .toBeNull();
    await page.waitForTimeout(200);
    await page.getByRole("link", { name: "Settings" }).click();
    await page.waitForURL(/\/settings$/);
    await page.getByRole("link", { name: "Issues", exact: true }).click();
    await page.waitForURL(
      /\/issues\?order=desc&priority=high&q=Alpha&sort=priority&status=todo&view=list&saved_view=[0-9a-f-]{36}$/,
      { timeout: 10_000 },
    );
    await expect(
      page.getByRole("button", { name: "High priority, Active" }),
    ).toBeVisible();
    await expect(page.getByTestId("favorite-views-nav")).toHaveCount(0);

    await page.getByRole("link", { name: "Views" }).click();
    await viewsList
      .getByRole("button", { name: "Actions for High priority" })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const deleteDialog = page.getByRole("dialog", {
      name: "Delete saved view?",
    });
    await expect(
      deleteDialog.getByRole("button", { name: "Cancel" }),
    ).toBeFocused();
    await deleteDialog.getByRole("button", { name: "Delete" }).click();
    await expect(viewsList).toHaveCount(0);
    await expect(page.getByTestId("saved-views-empty")).toBeVisible();
    await expect
      .poll(() => readIndexedDbConfig(page, DEFAULT_POINTER_KEY))
      .toBeUndefined();
    await expect
      .poll(() => readIndexedDbConfig(page, FAVORITES_KEY))
      .toBe('{"version":1,"ids":[]}');
    expect(
      (await readFixtureState(request)).vaults[0]?.saved_views,
    ).toHaveLength(0);
  });

  test("shows duplicate errors inline and provisions a missing table only on write", async ({
    page,
    request,
  }) => {
    await dropFixtureTable(request, "reef_views");
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?status=todo&view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({ timeout: 15_000 });
    expect((await readFixtureState(request)).vaults[0]?.tables).not.toContain(
      "reef_views",
    );

    // An empty Views read remains DDL-free.
    await page.getByRole("link", { name: "Views" }).click();
    await page.waitForURL("/workspace/reef-e2e/views");
    await expect(page.getByTestId("saved-views-empty")).toBeVisible();
    expect((await readFixtureState(request)).vaults[0]?.tables).not.toContain(
      "reef_views",
    );
    await page.getByRole("link", { name: "Issues", exact: true }).click();

    const save = async (name: string) => {
      await page.getByRole("button", { name: "Save view" }).click();
      const dialog = page.getByTestId("save-view-dialog");
      await dialog.getByLabel("View name").fill(name);
      await dialog.getByRole("button", { name: "Save view" }).click();
      return dialog;
    };
    await save("Todo");
    await expect
      .poll(async () =>
        (await readFixtureState(request)).vaults[0]?.tables.includes(
          "reef_views",
        ),
      )
      .toBe(true);
    await page.getByRole("link", { name: "Views" }).click();
    await expect(
      page.getByTestId("saved-views-list").getByRole("link", { name: "Todo" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Issues", exact: true }).click();

    const duplicate = await save("  TODO  ");
    await expect(duplicate.getByRole("alert")).toHaveText(
      "A view with that name already exists.",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Save view" })).toBeFocused();

    await page.goto("/workspace/reef-e2e/issues?filter=none");
    await expect(page.getByRole("button", { name: "Save view" })).toBeVisible();
  });
});
