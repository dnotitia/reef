import { type Page, expect, test } from "@playwright/test";
import {
  continueToWorkspace,
  resetFixture,
  signInAsAlice,
} from "./harness/fixture";

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

async function saveNamedFilter(page: Page, name: string): Promise<void> {
  await selectTodo(page);
  await page.getByTestId("named-filter-trigger").click();
  await page.getByRole("menuitem", { name: "Save current filter…" }).click();
  const dialog = page.getByTestId("named-filter-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("named-filter-name-input").fill(name);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("named-filter-trigger")).toHaveAttribute(
    "aria-label",
    new RegExp(name),
  );
}

async function openNamedFilterMenu(page: Page) {
  await page.getByTestId("named-filter-trigger").click();
  const menu = page.getByTestId("named-filter-menu");
  await expect(menu).toBeVisible();
  return menu;
}

test.describe("Hermetic named issue filters", () => {
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
    await expect(page).toHaveURL(/view=list/);

    const savedName = "My triage view";
    await page.getByTestId("named-filter-trigger").click();
    await page.getByRole("menuitem", { name: "Save current filter…" }).click();
    const saveDialog = page.getByTestId("named-filter-dialog");
    await saveDialog.getByTestId("named-filter-name-input").fill(savedName);
    await saveDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(saveDialog).toBeHidden();
    await expect(page.getByTestId("named-filter-trigger")).toHaveAttribute(
      "aria-label",
      /My triage view.*Active/,
    );

    // Change the working state and add one-off search before applying the named
    // payload. The view mode remains List while every named filter field is
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
        url.searchParams.get("status") === "todo" &&
        url.searchParams.get("sort") === "title" &&
        url.searchParams.get("order") === "asc" &&
        !url.searchParams.has("q")
      );
    });
    const menu = await openNamedFilterMenu(page);
    await menu.getByRole("menuitem", { name: /^My triage view/ }).click();
    await applyNavigation;
    const appliedUrl = new URL(page.url());
    expect(appliedUrl.searchParams.get("view")).toBe("list");
    expect(appliedUrl.searchParams.get("archived")).toBe("1");
    expect(appliedUrl.searchParams.has("named_filter")).toBe(false);
    expect(appliedUrl.toString()).not.toContain(savedName);
    await expect(page.getByTestId("search-input")).toHaveValue("");

    await page.reload();
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("named-filter-trigger")).toHaveAttribute(
      "aria-label",
      /My triage view.*Active/,
    );

    // A canonical change is visible and update removes it.
    await page.getByTestId("display-options-trigger").click();
    await page.getByTestId("show-archived-toggle").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("named-filter-trigger")).toHaveAttribute(
      "aria-label",
      /My triage view.*Changed/,
    );
    const changedMenu = await openNamedFilterMenu(page);
    await changedMenu
      .getByRole("menuitem", {
        name: `Update ${savedName} with the current filter`,
        exact: true,
      })
      .click();
    await expect(page.getByTestId("named-filter-trigger")).toHaveAttribute(
      "aria-label",
      /My triage view.*Active/,
    );

    const renamedName = "Renamed triage";
    const renameMenu = await openNamedFilterMenu(page);
    await renameMenu
      .getByRole("menuitem", { name: `Rename ${savedName}`, exact: true })
      .click();
    const renameDialog = page.getByTestId("named-filter-dialog");
    await renameDialog.getByTestId("named-filter-name-input").fill(renamedName);
    await renameDialog
      .getByRole("button", { name: "Rename", exact: true })
      .click();
    await expect(renameDialog).toBeHidden();
    await expect(page.getByTestId("named-filter-trigger")).toHaveAttribute(
      "aria-label",
      new RegExp(renamedName),
    );

    const copiedName = `${renamedName} copy`;
    const duplicateMenu = await openNamedFilterMenu(page);
    await duplicateMenu
      .getByRole("menuitem", { name: `Duplicate ${renamedName}`, exact: true })
      .click();
    const duplicateDialog = page.getByTestId("named-filter-dialog");
    await expect(
      duplicateDialog.getByTestId("named-filter-name-input"),
    ).toHaveValue(copiedName);
    await duplicateDialog
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(duplicateDialog).toBeHidden();

    // The same duplicate is rejected and leaves the existing records intact.
    const duplicateAgainMenu = await openNamedFilterMenu(page);
    await duplicateAgainMenu
      .getByRole("menuitem", {
        name: `Duplicate ${renamedName}`,
        exact: true,
      })
      .click();
    const duplicateErrorDialog = page.getByTestId("named-filter-dialog");
    await duplicateErrorDialog
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(duplicateErrorDialog.getByRole("alert")).toHaveText(
      "A filter with that name already exists.",
    );
    await duplicateErrorDialog
      .getByRole("button", { name: "Cancel", exact: true })
      .click();

    const deleteMenu = await openNamedFilterMenu(page);
    await deleteMenu
      .getByRole("menuitem", { name: `Delete ${copiedName}`, exact: true })
      .click();
    const deleteDialog = page.getByTestId("named-filter-delete-dialog");
    await deleteDialog.getByTestId("named-filter-confirm-delete").click();
    await expect(deleteDialog).toBeHidden();
    const finalMenu = await openNamedFilterMenu(page);
    await expect(finalMenu.getByText(copiedName, { exact: true })).toHaveCount(
      0,
    );
  });

  test("isolates vaults and clears browser-local named filters during account reconciliation", async ({
    page,
  }) => {
    await openMultiVaultWorkspace(page, "reef-e2e");
    await page.goto("/workspace/reef-e2e/issues?view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({
      timeout: 15_000,
    });
    await saveNamedFilter(page, "Acme-only view");

    await page.goto("/workspace/reef-zeta/issues?view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({
      timeout: 15_000,
    });
    const otherVaultMenu = await openNamedFilterMenu(page);
    await expect(
      otherVaultMenu.getByText("No saved filters yet.", { exact: true }),
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
    const reconciledMenu = await openNamedFilterMenu(page);
    await expect(
      reconciledMenu.getByText("No saved filters yet.", { exact: true }),
    ).toBeVisible();
  });
});
