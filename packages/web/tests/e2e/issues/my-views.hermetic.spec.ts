import { test as workspaceTest } from "../harness/workspace-fixture";
import { type Page, type Route, expect } from "@playwright/test";
import {
  continueToWorkspace,
  signInAsAlice,
  openExistingWorkspace,
} from "../harness/fixture";

const test = workspaceTest.extend({ scenario: "configured_multi" });

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
  test("saves, applies, reloads, updates, renames, duplicates, rejects duplicates, and deletes", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
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
    type GateWindow = Window & {
      __reefMyViewWriteGate?: { held: boolean; pending: Array<() => void> };
    };
    await page.addInitScript(`
      (() => {
        const gate = window.__reefMyViewWriteGate = { held: false, pending: [] };
        const writes = new WeakSet();
        const originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(value, ...keys) {
          if (this.name === "config" && value?.key?.startsWith("my_view:")) {
            writes.add(this.transaction);
          }
          return originalPut.call(this, value, ...keys);
        };
        const completion = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, "oncomplete");
        Object.defineProperty(IDBTransaction.prototype, "oncomplete", {
          configurable: true,
          get: completion.get,
          set(listener) {
            if (typeof listener !== "function") {
              completion.set.call(this, listener);
              return;
            }
            const transaction = this;
            completion.set.call(this, (event) => {
              const deliver = () => listener.call(transaction, event);
              if (gate.held && writes.has(transaction)) gate.pending.push(deliver);
              else deliver();
            });
          },
        });
      })();
    `);
    await openExistingWorkspace(page);
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
    await page.evaluate(() => {
      const gate = (window as GateWindow).__reefMyViewWriteGate;
      if (!gate) throw new Error("My View write gate is not installed");
      gate.held = true;
    });
    await menu
      .getByRole("menuitem", {
        name: `Update ${savedName} with the current view`,
        exact: true,
      })
      .click();

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as GateWindow).__reefMyViewWriteGate?.pending.length ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    await expect(trigger).toHaveAttribute(
      "aria-label",
      new RegExp(`${savedName}.*Changed`),
    );
    await page.evaluate(() => {
      const gate = (window as GateWindow).__reefMyViewWriteGate;
      if (!gate) throw new Error("My View write gate is not installed");
      gate.held = false;
      for (const deliver of gate.pending.splice(0)) deliver();
    });

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

  test("isolates vaults and clears browser-local My Views during account reconciliation", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
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
    await expect(page.getByTestId("akb-login-form")).toBeVisible();
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

  test("drops a pending prior-vault result when switching workspaces", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list&sort=priority");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({ timeout: 15_000 });

    // UI-only delivery scheduling: route.fetch still executes Reef's real
    // authenticated handler and external AKB read. Hold its unchanged response
    // so the old search can finish after the destination has rendered.
    const searchGate = Promise.withResolvers<void>();
    const searchDelivery = Promise.withResolvers<void>();
    let responseHeld = false;
    const isSearchRequest = (url: URL) =>
      url.pathname === "/api/issues" &&
      url.searchParams.get("vault") === "reef-e2e" &&
      url.searchParams.get("q") === "Alpha";
    const holdSearchResponse = async (route: Route) => {
      try {
        const response = await route.fetch();
        responseHeld = true;
        await searchGate.promise;
        await route.fulfill({ response });
      } catch {
        // A vault switch may abort the old request; the assertion below is the
        // observable contract, and the route no longer needs a response.
      } finally {
        searchDelivery.resolve();
      }
    };
    await page.route(isSearchRequest, holdSearchResponse);

    const vaultGate = Promise.withResolvers<void>();
    const vaultDelivery = Promise.withResolvers<void>();
    let vaultResponseHeld = false;
    const isZetaIssueRequest = (url: URL) =>
      url.pathname === "/api/issues" &&
      url.searchParams.get("vault") === "reef-zeta" &&
      !url.searchParams.has("limit") &&
      !url.searchParams.has("q");
    const holdZetaResponse = async (route: Route) => {
      try {
        const response = await route.fetch();
        vaultResponseHeld = true;
        await vaultGate.promise;
        await route.fulfill({ response });
      } catch {
        // The route is released with the old search request below.
      } finally {
        vaultDelivery.resolve();
      }
    };
    await page.route(isZetaIssueRequest, holdZetaResponse);

    const input = page.getByTestId("search-input");
    await input.fill("Alpha");
    await expect(page).toHaveURL(/q=Alpha/);
    await expect.poll(() => responseHeld, { timeout: 15_000 }).toBe(true);

    await page.getByTestId("sidebar-workspace-trigger").click();
    await page.getByTestId("workspace-switcher-option-reef-zeta").click();
    await expect(page).toHaveURL(/\/workspace\/reef-zeta\/issues/);
    // A workspace with no saved view opens its default Board. Observe that
    // destination surface rather than the departed workspace's List rows.
    await expect(
      page
        .getByTestId("view-switcher")
        .getByRole("button", { name: "Board", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => vaultResponseHeld, { timeout: 15_000 }).toBe(true);
    await expect(page.getByTestId("search-input")).toHaveValue("");
    const cards = page
      .getByTestId("kanban-board-body")
      .getByTestId("kanban-card");
    await expect(cards).toHaveCount(0);

    try {
      vaultGate.resolve();
      await vaultDelivery.promise;
      await expect(cards).toHaveCount(2);
      await expect
        .poll(() =>
          cards.evaluateAll((elements) =>
            elements
              .map((element) => element.getAttribute("data-issue-id"))
              .sort(),
          ),
        )
        .toEqual(["REEF-001", "REEF-002"]);
      searchGate.resolve();
      await searchDelivery.promise;
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(cards).toHaveCount(2);
      await expect
        .poll(() =>
          cards.evaluateAll((elements) =>
            elements
              .map((element) => element.getAttribute("data-issue-id"))
              .sort(),
          ),
        )
        .toEqual(["REEF-001", "REEF-002"]);
      await expect(page.getByTestId("search-input")).toHaveValue("");
      await expect(page).toHaveURL(/\/workspace\/reef-zeta\/issues(?:\?|$)/);
      expect(new URL(page.url()).searchParams.has("q")).toBe(false);
    } finally {
      searchGate.resolve();
      vaultGate.resolve();
      await Promise.all([searchDelivery.promise, vaultDelivery.promise]);
      await page.unroute(isSearchRequest, holdSearchResponse);
      await page.unroute(isZetaIssueRequest, holdZetaResponse);
    }
  });
});
