const { behaviorReason, runClause } = require("./runtime.cjs");

const NAMED_FILTER_CLAUSE = "B2:named-issue-filters";
const NAMED_FILTER_CLAUSES = [
  `${NAMED_FILTER_CLAUSE}.B1`,
  `${NAMED_FILTER_CLAUSE}.B2`,
  `${NAMED_FILTER_CLAUSE}.B3`,
  `${NAMED_FILTER_CLAUSE}.B4`,
  `${NAMED_FILTER_CLAUSE}.B5`,
];

async function selectTodo(page, expect) {
  await page.getByTestId("status-dropdown-trigger").click();
  await page.getByTestId("status-option-todo").click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/status=todo/);
}

async function saveNamedFilter(page, expect, name) {
  await selectTodo(page, expect);
  await page.getByTestId("named-filter-trigger").click();
  await page
    .getByRole("menuitem", { name: "Save current filter…", exact: true })
    .click();
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

async function openNamedFilterMenu(page, expect) {
  await page.getByTestId("named-filter-trigger").click();
  const menu = page.getByTestId("named-filter-menu");
  await expect(menu).toBeVisible();
  return menu;
}

async function waitForNamedFilter(page, expect, name, state) {
  const pattern = new RegExp(`${escapeRegExp(name)}.*${escapeRegExp(state)}`);
  await expect(page.getByTestId("named-filter-trigger")).toHaveAttribute(
    "aria-label",
    pattern,
  );
}

async function seedMalformedNamedFilter(page, workspace) {
  await page.evaluate(async (vault) => {
    const key = `named_filter:${vault}:malformed`;
    const value = JSON.stringify({
      version: 1,
      id: "malformed",
      name: "Malformed persisted filter",
      nameKey: "malformed persisted filter",
      payload: { status: [{}], sortOrder: "sideways" },
    });
    const request = indexedDB.open("reef");
    await new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(undefined);
    });
    const database = request.result;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("config", "readwrite");
      const store = transaction.objectStore("config");
      const existing = store.index("key").get(key);
      existing.onsuccess = () => {
        const entry = existing.result;
        const write = entry?.id
          ? store.put({ id: entry.id, key, value })
          : store.add({ key, value });
        write.onerror = () => reject(write.error);
      };
      existing.onerror = () => reject(existing.error);
      transaction.oncomplete = () => resolve(undefined);
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, workspace);
}

async function runNamedIssueFiltersBehavior({
  page,
  expect,
  workspace = "reef-e2e",
  secondaryWorkspace = "reef-zeta",
  relogin,
}) {
  const clauses = [];

  // Keep the persistence race in the canonical behavior itself. The adapter
  // and hermetic spec therefore exercise the same eventual state transition.
  await page.addInitScript(`
    (() => {
      const originalAddEventListener = IDBRequest.prototype.addEventListener;
      IDBRequest.prototype.addEventListener = function (type, listener, options) {
        if (type !== "success" || typeof listener !== "function") {
          return originalAddEventListener.call(this, type, listener, options);
        }
        const request = this;
        return originalAddEventListener.call(request, type, (event) => {
          window.setTimeout(() => listener.call(request, event), 250);
        }, options);
      };
    })();
  `);
  await page.goto(
    `/workspace/${encodeURIComponent(workspace)}/issues?view=list`,
  );
  await expect(
    page.locator('[data-testid="issue-list-row"]').first(),
  ).toBeVisible({ timeout: 15_000 });

  const recordClause = async (id, callback) => {
    try {
      const result = await runClause(id, callback);
      clauses.push({
        id,
        status: "pass",
        observable: result.observable,
        details: result.details,
      });
    } catch (error) {
      const reason = behaviorReason(error);
      clauses.push({
        id,
        status: reason ? "blocked" : "fail",
        ...(reason ? { reason } : {}),
        observable: error instanceof Error ? error.message : String(error),
        details: null,
      });
    }
  };

  const savedName = "My triage view";
  const renamedName = "Renamed triage";
  const copiedName = `${renamedName} copy`;

  await recordClause(NAMED_FILTER_CLAUSES[0], async () => {
    await selectTodo(page, expect);
    await page.getByTestId("display-options-trigger").click();
    await page.getByTestId("show-archived-toggle").click();
    await page.keyboard.press("Escape");
    await page.getByTestId("sort-control-trigger").click();
    await page.getByTestId("sort-option-title").click();
    await page.getByTestId("named-filter-trigger").click();
    await page
      .getByRole("menuitem", { name: "Save current filter…", exact: true })
      .click();
    const dialog = page.getByTestId("named-filter-dialog");
    await dialog.getByTestId("named-filter-name-input").fill(savedName);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    await waitForNamedFilter(page, expect, savedName, "Active");

    await page.reload();
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({ timeout: 15_000 });
    await waitForNamedFilter(page, expect, savedName, "Active");
    const menu = await openNamedFilterMenu(page, expect);
    await expect(menu.getByText(savedName, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    return {
      observable:
        "A named filter remained listed after reload and was announced as the active browser-local preset.",
      details: { saved_name: savedName, restored: true },
    };
  });

  await recordClause(NAMED_FILTER_CLAUSES[1], async () => {
    const search = page.getByTestId("search-input");
    await search.fill("temporary");
    await page.waitForURL((url) => url.searchParams.get("q") === "temporary", {
      timeout: 15_000,
    });
    const applyNavigation = page.waitForURL(
      (url) =>
        url.searchParams.get("view") === "list" &&
        url.searchParams.get("status") === "todo" &&
        url.searchParams.get("archived") === "1" &&
        url.searchParams.get("sort") === "title" &&
        url.searchParams.get("order") === "asc" &&
        !url.searchParams.has("q"),
      { timeout: 15_000 },
    );
    const menu = await openNamedFilterMenu(page, expect);
    await menu.getByRole("menuitem", { name: /^My triage view/ }).click();
    await applyNavigation;
    const url = new URL(page.url());
    expect(url.searchParams.get("view")).toBe("list");
    expect(url.searchParams.has("named_filter")).toBe(false);
    expect(url.toString()).not.toContain(savedName);
    await expect(search).toHaveValue("");
    return {
      observable:
        "Applying the named preset replaced the issue query, cleared one-off search, preserved List mode, and kept local ids/names out of the canonical URL.",
      details: {
        final_url: `${url.pathname}${url.search}`,
        search_cleared: true,
      },
    };
  });

  await recordClause(NAMED_FILTER_CLAUSES[2], async () => {
    await page.getByTestId("display-options-trigger").click();
    await page.getByTestId("show-archived-toggle").click();
    await page.keyboard.press("Escape");
    await waitForNamedFilter(page, expect, savedName, "Changed");
    let menu = await openNamedFilterMenu(page, expect);
    await menu
      .getByRole("menuitem", {
        name: `Update ${savedName} with the current filter`,
        exact: true,
      })
      .click();
    await waitForNamedFilter(page, expect, savedName, "Active");

    menu = await openNamedFilterMenu(page, expect);
    await menu
      .getByRole("menuitem", { name: `Rename ${savedName}`, exact: true })
      .click();
    const renameDialog = page.getByTestId("named-filter-dialog");
    await renameDialog.getByTestId("named-filter-name-input").fill(renamedName);
    await renameDialog
      .getByRole("button", { name: "Rename", exact: true })
      .click();
    await expect(renameDialog).toBeHidden();
    await waitForNamedFilter(page, expect, renamedName, "Active");

    menu = await openNamedFilterMenu(page, expect);
    await menu
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

    menu = await openNamedFilterMenu(page, expect);
    await menu
      .getByRole("menuitem", { name: `Duplicate ${renamedName}`, exact: true })
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

    menu = await openNamedFilterMenu(page, expect);
    await menu
      .getByRole("menuitem", { name: `Delete ${copiedName}`, exact: true })
      .click();
    const deleteDialog = page.getByTestId("named-filter-delete-dialog");
    await deleteDialog.getByTestId("named-filter-confirm-delete").click();
    await expect(deleteDialog).toBeHidden();
    menu = await openNamedFilterMenu(page, expect);
    await expect(menu.getByText(copiedName, { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    return {
      observable:
        "Changed and active states were announced, update cleared changed state, and rename/duplicate/delete operations stayed scoped to the intended records with duplicate rejection.",
      details: {
        renamed_name: renamedName,
        duplicate_rejected: true,
        deleted_copy: true,
      },
    };
  });

  await recordClause(NAMED_FILTER_CLAUSES[3], async () => {
    await page.goto(
      `/workspace/${encodeURIComponent(secondaryWorkspace)}/issues?view=list`,
    );
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({ timeout: 20_000 });
    await seedMalformedNamedFilter(page, secondaryWorkspace);
    await page.reload();
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({ timeout: 20_000 });
    const otherMenu = await openNamedFilterMenu(page, expect);
    await expect(
      otherMenu.getByText("Unavailable", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(otherMenu.getByText(renamedName, { exact: true })).toHaveCount(
      0,
    );
    await expect(otherMenu.getByText(copiedName, { exact: true })).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");

    if (!relogin) throw new Error("named-filter behavior requires relogin");
    await page.getByLabel("Account menu", { exact: true }).click();
    await page.getByTestId("account-signout").click();
    await page.waitForURL((url) => url.pathname === "/login", {
      timeout: 15_000,
    });
    await relogin();
    await page.goto(
      `/workspace/${encodeURIComponent(workspace)}/issues?view=list`,
    );
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({ timeout: 20_000 });
    const reconciledMenu = await openNamedFilterMenu(page, expect);
    await expect(
      reconciledMenu.getByText("No saved filters yet.", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    return {
      observable:
        "A second vault could not observe the primary vault's filters, malformed persisted data was unavailable, and account reconciliation removed browser-local records.",
      details: {
        secondary_workspace: secondaryWorkspace,
        malformed_payload: "Unavailable",
        post_reconciliation: "No saved filters yet.",
      },
    };
  });

  await recordClause(NAMED_FILTER_CLAUSES[4], async () => {
    await selectTodo(page, expect);
    const trigger = page.getByTestId("named-filter-trigger");
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page
      .getByRole("menuitem", { name: "Save current filter…", exact: true })
      .click();
    const dialog = page.getByTestId("named-filter-dialog");
    await dialog.getByTestId("named-filter-name-input").press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    return {
      observable:
        "The menu and save dialog were keyboard-dismissible with visible focus returning to the named-filter trigger.",
      details: { menu_escape_focus: true, dialog_escape_focus: true },
    };
  });

  const failed = clauses.find((clause) => clause.status !== "pass");
  if (failed) {
    const error = new Error(failed.observable);
    error.behavior_clause = failed.id;
    error.behavior_clauses = clauses;
    if (failed.reason) error.behavior_reason = failed.reason;
    throw error;
  }

  return {
    clause_id: NAMED_FILTER_CLAUSE,
    observable:
      "The canonical named-filter behavior completed persistence, apply, update, rename, duplicate rejection, deletion, vault isolation, reconciliation, and focus checks.",
    details: { clauses },
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\[\]\\]/g, "\\$&");
}

module.exports = {
  NAMED_FILTER_CLAUSE,
  NAMED_FILTER_CLAUSES,
  openNamedFilterMenu,
  runNamedIssueFiltersBehavior,
  saveNamedFilter,
  selectTodo,
};
