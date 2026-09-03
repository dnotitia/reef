import { type Page, expect, test } from "@playwright/test";
import {
  continueToWorkspace,
  resetFixture,
  signInAsAlice,
} from "../harness/fixture";

async function openMultiVaultWorkspace(
  page: Page,
  vault: string,
): Promise<void> {
  await signInAsAlice(page);
  await page.goto(`/workspace/${vault}/issues`);
  await continueToWorkspace(page, vault);
}

async function selectTodo(page: Page): Promise<void> {
  await page.getByTestId("status-dropdown-trigger").click();
  await page.getByTestId("status-option-todo").click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/status=todo/);
}

async function saveMyView(page: Page, name: string): Promise<void> {
  await selectTodo(page);
  await page.getByTestId("my-view-trigger").click();
  await page.getByRole("menuitem", { name: "Save current view…" }).click();
  const dialog = page.getByTestId("my-view-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("my-view-name-input").fill(name);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("my-view-trigger")).toHaveAttribute(
    "aria-label",
    new RegExp(name),
  );
}

async function openMyViewMenu(page: Page) {
  await page.getByTestId("my-view-trigger").click();
  const menu = page.getByTestId("my-view-menu");
  await expect(menu).toBeVisible();
  return menu;
}

test.describe("Hermetic My Views", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured_multi");
  });

  test("saves, applies, reloads, updates, renames, duplicates, rejects duplicates, and deletes", async ({
    page,
  }) => {
    await openMultiVaultWorkspace(page, "reef-e2e");
    await page.goto("/workspace/reef-e2e/issues?view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({
      timeout: 15_000,
    });

    await selectTodo(page);
    await page.getByTestId("display-options-trigger").click();
    await page.getByTestId("show-archived-toggle").click();
    await page.keyboard.press("Escape");
    await page.getByTestId("sort-control-trigger").click();
    await page.getByTestId("sort-option-title").click();
    await page.getByTestId("display-options-trigger").click();
    await page.getByTestId("group-by-label").click();
    await page.getByTestId("display-options-trigger").click();
    await page.getByTestId("issue-list-column-start").click();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/view=list/);

    const savedName = "My triage view";
    await page.getByTestId("my-view-trigger").click();
    await page.getByRole("menuitem", { name: "Save current view…" }).click();
    const saveDialog = page.getByTestId("my-view-dialog");
    await saveDialog.getByTestId("my-view-name-input").fill(savedName);
    await saveDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(saveDialog).toBeHidden();
    await expect(page.getByTestId("my-view-trigger")).toHaveAttribute(
      "aria-label",
      /My triage view.*Active/,
    );

    // Change the working state and add one-off search before applying the My View
    // payload. The view mode remains List while every My View field is
    // replaced and the query is cleared.
    await page.getByTestId("status-dropdown-trigger").click();
    await page.getByTestId("status-option-todo").click();
    await page.getByTestId("status-option-in_progress").click();
    await page.keyboard.press("Escape");
    await page.getByTestId("display-options-trigger").click();
    await page.getByTestId("show-archived-toggle").click();
    await page.keyboard.press("Escape");
    await page.getByTestId("search-input").fill("temporary");
    await expect(page).toHaveURL(/q=temporary/);

    const applyNavigation = page.waitForURL((url) => {
      return (
        url.searchParams.get("view") === "list" &&
        url.searchParams.get("group") === "label" &&
        url.searchParams.get("columns") === "start" &&
        url.searchParams.get("status") === "todo" &&
        url.searchParams.get("sort") === "title" &&
        url.searchParams.get("order") === "asc" &&
        !url.searchParams.has("q")
      );
    });
    const menu = await openMyViewMenu(page);
    await menu.getByRole("menuitem", { name: /^My triage view/ }).click();
    await applyNavigation;
    const appliedUrl = new URL(page.url());
    expect(appliedUrl.searchParams.get("view")).toBe("list");
    expect(appliedUrl.searchParams.get("group")).toBe("label");
    expect(appliedUrl.searchParams.get("columns")).toBe("start");
    expect(appliedUrl.searchParams.get("archived")).toBe("1");
    expect(appliedUrl.searchParams.has("my_view")).toBe(false);
    expect(appliedUrl.toString()).not.toContain(savedName);
    await expect(page.getByTestId("search-input")).toHaveValue("");

    await page.reload();
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("my-view-trigger")).toHaveAttribute(
      "aria-label",
      /My triage view.*Active/,
    );

    // A canonical change is visible and update removes it.
    await page.getByTestId("display-options-trigger").click();
    await page.getByTestId("show-archived-toggle").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("my-view-trigger")).toHaveAttribute(
      "aria-label",
      /My triage view.*Changed/,
    );
    const changedMenu = await openMyViewMenu(page);
    await changedMenu
      .getByRole("menuitem", {
        name: `Update ${savedName} with the current view`,
        exact: true,
      })
      .click();
    await expect(page.getByTestId("my-view-trigger")).toHaveAttribute(
      "aria-label",
      /My triage view.*Active/,
    );

    const renamedName = "Renamed triage";
    const renameMenu = await openMyViewMenu(page);
    await renameMenu
      .getByRole("menuitem", { name: `Rename ${savedName}`, exact: true })
      .click();
    const renameDialog = page.getByTestId("my-view-dialog");
    await renameDialog.getByTestId("my-view-name-input").fill(renamedName);
    await renameDialog
      .getByRole("button", { name: "Rename", exact: true })
      .click();
    await expect(renameDialog).toBeHidden();
    await expect(page.getByTestId("my-view-trigger")).toHaveAttribute(
      "aria-label",
      new RegExp(renamedName),
    );

    const copiedName = `${renamedName} copy`;
    const duplicateMenu = await openMyViewMenu(page);
    await duplicateMenu
      .getByRole("menuitem", { name: `Duplicate ${renamedName}`, exact: true })
      .click();
    const duplicateDialog = page.getByTestId("my-view-dialog");
    await expect(duplicateDialog.getByTestId("my-view-name-input")).toHaveValue(
      copiedName,
    );
    await duplicateDialog
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(duplicateDialog).toBeHidden();

    // The same duplicate is rejected and leaves the existing records intact.
    const duplicateAgainMenu = await openMyViewMenu(page);
    await duplicateAgainMenu
      .getByRole("menuitem", {
        name: `Duplicate ${renamedName}`,
        exact: true,
      })
      .click();
    const duplicateErrorDialog = page.getByTestId("my-view-dialog");
    await duplicateErrorDialog
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(duplicateErrorDialog.getByRole("alert")).toHaveText(
      "A My View with that name already exists.",
    );
    await duplicateErrorDialog
      .getByRole("button", { name: "Cancel", exact: true })
      .click();

    const deleteMenu = await openMyViewMenu(page);
    await deleteMenu
      .getByRole("menuitem", { name: `Delete ${copiedName}`, exact: true })
      .click();
    const deleteDialog = page.getByTestId("my-view-delete-dialog");
    await deleteDialog.getByTestId("my-view-confirm-delete").click();
    await expect(deleteDialog).toBeHidden();
    const finalMenu = await openMyViewMenu(page);
    await expect(finalMenu.getByText(copiedName, { exact: true })).toHaveCount(
      0,
    );

    // Keep the focus regression on the same post-CRUD handoff path as the
    // My View scenario.
    await page.keyboard.press("Escape");
    const trigger = page.getByTestId("my-view-trigger");
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole("menuitem", { name: "Save current view…" }).click();
    const escapeDialog = page.getByTestId("my-view-dialog");
    await escapeDialog.getByTestId("my-view-name-input").press("Escape");
    await expect(escapeDialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("clears Changed from the trigger after the update action persists", async ({
    page,
  }) => {
    await page.addInitScript(`
      (() => {
        const originalAddEventListener = IDBRequest.prototype.addEventListener;
        IDBRequest.prototype.addEventListener = function (type, listener, options) {
          if (type !== "success" || typeof listener !== "function") {
            return originalAddEventListener.call(this, type, listener, options);
          }
          const request = this;
          return originalAddEventListener.call(this, type, (event) => {
            window.setTimeout(() => listener.call(request, event), 250);
          }, options);
        };
      })();
    `);
    await openMultiVaultWorkspace(page, "reef-e2e");
    await page.goto("/workspace/reef-e2e/issues?view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({ timeout: 15_000 });

    const savedName = "Changed update view";
    await saveMyView(page, savedName);
    const trigger = page.getByTestId("my-view-trigger");
    await page.getByTestId("display-options-trigger").click();
    await page.getByTestId("show-archived-toggle").click();
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute(
      "aria-label",
      new RegExp(`${savedName}.*Changed`),
    );

    const menu = await openMyViewMenu(page);
    await menu
      .getByRole("menuitem", {
        name: `Update ${savedName} with the current view`,
        exact: true,
      })
      .click();

    // Persistence is browser-local and asynchronous; wait for the bounded
    // eventual state transition rather than treating the unchanged name as
    // proof that the write has completed.
    await expect(trigger).toHaveAttribute(
      "aria-label",
      new RegExp(`${savedName}.*Active`),
    );
    await expect(trigger).not.toHaveAttribute(
      "aria-label",
      new RegExp(`${savedName}.*Changed`),
    );
  });

  test("returns focus to the trigger when Escape closes the my-view dialog", async ({
    page,
  }) => {
    await openMultiVaultWorkspace(page, "reef-e2e");
    await page.goto("/workspace/reef-e2e/issues?view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({ timeout: 15_000 });
    await selectTodo(page);

    const trigger = page.getByTestId("my-view-trigger");
    await trigger.click();
    await page.getByRole("menuitem", { name: "Save current view…" }).click();
    const dialog = page.getByTestId("my-view-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("my-view-name-input").press("Escape");
    await expect(dialog).toBeHidden();
    await expect
      .poll(
        () => trigger.evaluate((element) => element === document.activeElement),
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test("isolates vaults and clears browser-local My Views during account reconciliation", async ({
    page,
  }) => {
    await openMultiVaultWorkspace(page, "reef-e2e");
    await page.goto("/workspace/reef-e2e/issues?view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({
      timeout: 15_000,
    });
    await saveMyView(page, "Acme-only view");

    await page.goto("/workspace/reef-zeta/issues?view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({
      timeout: 15_000,
    });
    const otherVaultMenu = await openMyViewMenu(page);
    await expect(
      otherVaultMenu.getByText("No saved views yet.", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByLabel("Account menu").click();
    await page.locator('[data-testid="account-signout"]').click();
    await page.waitForURL(/\/login$/, { timeout: 10_000 });
    await signInAsAlice(page);
    await page.goto("/workspace/reef-e2e/issues");
    await continueToWorkspace(page, "reef-e2e");
    await page.goto("/workspace/reef-e2e/issues?view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({
      timeout: 15_000,
    });
    const reconciledMenu = await openMyViewMenu(page);
    await expect(
      reconciledMenu.getByText("No saved views yet.", { exact: true }),
    ).toBeVisible();
  });
});
