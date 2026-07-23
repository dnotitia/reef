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

test.describe("Hermetic saved issue views", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("saves, links, updates, renames, defaults, and deletes a named view", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
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

    const nav = page.getByTestId("saved-views-nav");
    const viewLink = nav.getByRole("link", { name: "Alpha todo" });
    await expect(viewLink).toBeVisible();
    await expect(viewLink).toHaveAttribute(
      "href",
      "/workspace/reef-e2e/issues?order=desc&q=Alpha&sort=priority&status=todo&view=list",
    );
    await expect
      .poll(() => new URL(page.url()).searchParams.get("q"))
      .toBe("Alpha");
    await expect(viewLink).toHaveAttribute("aria-current", "page");

    await page.goto("/workspace/reef-e2e/issues?priority=high&view=list");
    await expect(viewLink).not.toHaveAttribute("aria-current", "page");
    await viewLink.click();
    await expect(viewLink).toHaveAttribute("aria-current", "page");
    await expect
      .poll(() =>
        Object.fromEntries(new URL(page.url()).searchParams.entries()),
      )
      .toEqual({
        order: "desc",
        q: "Alpha",
        sort: "priority",
        status: "todo",
        view: "list",
      });

    await page.goto("/workspace/reef-e2e/issues?priority=high&view=list");
    await page.getByRole("button", { name: "Actions for Alpha todo" }).click();
    await page
      .getByRole("menuitem", {
        name: "Update with current view",
      })
      .click();
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults[0]?.saved_views[0]?.payload;
      })
      .toEqual({
        version: 1,
        query: { priority: ["high"], view: ["list"] },
      });

    await page.getByRole("button", { name: "Actions for Alpha todo" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const renameDialog = page.getByRole("dialog", { name: "Rename" });
    await renameDialog.getByLabel("View name").fill("High priority");
    await renameDialog.getByRole("button", { name: "Save" }).click();
    const renamedLink = nav.getByRole("link", { name: "High priority" });
    await expect(renamedLink).toBeVisible();

    await page
      .getByRole("button", { name: "Actions for High priority" })
      .click();
    await page.getByRole("menuitem", { name: "Set as default" }).click();
    await expect
      .poll(() => readIndexedDbConfig(page, DEFAULT_POINTER_KEY))
      .toMatch(/^[0-9a-f-]{36}$/);

    // Leave the Issues store on a different explicit view before navigating
    // away. A fresh same-vault bare Issues mount must still re-evaluate the
    // named default instead of mirroring this retained in-memory filter.
    await page.goto("/workspace/reef-e2e/issues?status=todo&view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("q"))
      .toBeNull();
    // Let the warm search debounce finish reconciling the previous explicit
    // query before starting a cross-route navigation. This models a settled
    // view B instead of racing a hard page.goto against its hydration.
    await page.waitForTimeout(200);
    await page.getByRole("link", { name: "Settings" }).click();
    await page.waitForURL(/\/settings$/);
    await page.getByRole("link", { name: "Issues" }).click();
    await page.waitForURL(/\/issues\?priority=high&view=list$/, {
      timeout: 10_000,
    });
    await expect(renamedLink).toHaveAttribute("aria-current", "page");

    await page
      .getByRole("button", {
        name: "Actions for High priority",
      })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const deleteDialog = page.getByRole("dialog", {
      name: "Delete saved view?",
    });
    await expect(
      deleteDialog.getByRole("button", { name: "Cancel" }),
    ).toBeFocused();
    await deleteDialog.getByRole("button", { name: "Delete" }).click();
    await expect(nav).toHaveCount(0);
    await expect
      .poll(() => readIndexedDbConfig(page, DEFAULT_POINTER_KEY))
      .toBeUndefined();
    expect(
      (await readFixtureState(request)).vaults[0]?.saved_views,
    ).toHaveLength(0);
  });

  test("shows duplicate errors inline and provisions a previously missing table only on write", async ({
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

    const save = async (name: string) => {
      await page.getByRole("button", { name: "Save view" }).click();
      const dialog = page.getByTestId("save-view-dialog");
      await dialog.getByLabel("View name").fill(name);
      await dialog.getByRole("button", { name: "Save view" }).click();
      return dialog;
    };
    await save("Todo");
    await expect(page.getByRole("link", { name: "Todo" })).toBeVisible();
    expect((await readFixtureState(request)).vaults[0]?.tables).toContain(
      "reef_views",
    );

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
