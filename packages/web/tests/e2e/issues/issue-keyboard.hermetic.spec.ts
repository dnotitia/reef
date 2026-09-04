import { type Locator, type Page, expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "../harness/fixture";

async function issueStatus(
  request: Parameters<typeof readFixtureState>[0],
  issueId: string,
): Promise<string | undefined> {
  const state = await readFixtureState(request);
  return state.vaults
    .find((vault) => vault.name === REEF_E2E_VAULT)
    ?.issues.find((issue) => issue.id === issueId)?.status;
}

async function expectIssueListKeyboardReady(page: Page) {
  const rows = page.locator('[data-testid="issue-list-row"]');
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  await expect(rows.first()).toHaveAttribute("tabindex", "0", {
    timeout: 15_000,
  });
  return rows;
}

async function expectFocusedGeometryStable(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate(async (element) => {
        const before = element.getBoundingClientRect();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const after = element.getBoundingClientRect();
        return (
          document.activeElement === element &&
          after.width > 0 &&
          after.height > 0 &&
          before.x === after.x &&
          before.y === after.y &&
          before.width === after.width &&
          before.height === after.height
        );
      }),
    )
    .toBe(true);
}

test.describe("Hermetic issue keyboard navigation", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("moves list focus with j/k and opens the focused issue with Enter", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");

    const rows = await expectIssueListKeyboardReady(page);

    await page.keyboard.press("j");
    await expect(rows.nth(0)).toHaveAttribute("data-keyboard-focused", "true");
    await page.keyboard.press("j");
    await expect(rows.nth(1)).toHaveAttribute("data-keyboard-focused", "true");
    await page.keyboard.press("k");
    await expect(rows.nth(0)).toHaveAttribute("data-keyboard-focused", "true");
    const focusedIssueId = await rows.nth(0).getAttribute("data-issue-id");
    expect(focusedIssueId).toBeTruthy();
    if (!focusedIssueId) throw new Error("Missing focused issue id");

    await page.keyboard.press("Enter");
    await page.waitForURL(
      (url) =>
        url.pathname ===
          `/workspace/${REEF_E2E_VAULT}/issues/${focusedIssueId}` &&
        url.searchParams.get("view") === "list",
      { timeout: 10_000 },
    );
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
  });

  test("opens List and Backlog rows with Space and keeps checkbox keyboard semantics", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    for (const view of ["list", "backlog"] as const) {
      const query =
        view === "backlog"
          ? "scope=backlog&view=list"
          : "scope=active&view=list";
      await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?${query}`);
      const rows =
        view === "list"
          ? await expectIssueListKeyboardReady(page)
          : page.locator('[data-testid="backlog-row"]');
      await expect(rows.first()).toBeVisible({ timeout: 15_000 });

      const row = rows.first();
      const issueId = await row.getAttribute("data-issue-id");
      expect(issueId).toBeTruthy();
      if (!issueId) throw new Error(`Missing issue id for ${view} row`);
      const checkbox = row.getByRole("checkbox").first();
      await checkbox.focus();
      await page.keyboard.press("Space");
      await expect(row).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Enter");
      await expect(row).not.toHaveAttribute("aria-selected", "true");

      await row.focus();
      await page.keyboard.press("Space");
      await page.waitForURL(
        (url) =>
          url.pathname === `/workspace/${REEF_E2E_VAULT}/issues/${issueId}` &&
          url.searchParams.get("scope") ===
            (view === "backlog" ? "backlog" : "active") &&
          url.searchParams.get("view") === "list",
        { timeout: 10_000 },
      );
      await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    }
  });

  test("separates pointer selection, keyboard focus, and text-entry focus chrome", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);

    const rows = await expectIssueListKeyboardReady(page);
    const selectedRow = rows.filter({ hasText: "Initial issue Alpha" });
    await selectedRow.getByTestId("issue-row-checkbox").click();
    await expect(selectedRow).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-testid="issue-detail"]')).toHaveCount(0);

    const pointerSelection = await selectedRow.evaluate((element) => {
      const checkbox = element.querySelector<HTMLInputElement>(
        '[data-testid="issue-row-checkbox"]',
      );
      const label = checkbox?.closest("label");
      const boundary = element.querySelector<HTMLElement>(
        'td[data-column-key="select"]',
      );
      return {
        inputFocusVisible: checkbox?.matches(":focus-visible") ?? false,
        labelOutlineStyle: label ? getComputedStyle(label).outlineStyle : "",
        labelOutlineWidth: label ? getComputedStyle(label).outlineWidth : "",
        rowBoundary: boundary
          ? getComputedStyle(boundary, "::after").content
          : "",
      };
    });
    expect(pointerSelection.inputFocusVisible).toBe(false);
    expect(pointerSelection.labelOutlineStyle).toBe("none");
    expect(pointerSelection.rowBoundary).toBe("none");

    // Start from the header checkbox so the next real Tab enters an
    // unselected row checkbox and establishes keyboard-visible focus.
    const selectAll = page.getByTestId("issue-select-all");
    await selectAll.focus();
    await page.keyboard.press("Tab");
    const keyboardCheckbox = page.getByTestId("issue-row-checkbox").first();
    await expect(keyboardCheckbox).toBeFocused();
    const keyboardSelection = await keyboardCheckbox.evaluate((element) => {
      const label = element.closest("label");
      const row = element.closest("tr");
      const labelStyles = label ? getComputedStyle(label) : null;
      const rowBoundary = row?.querySelector<HTMLElement>(
        'td[data-column-key="select"]',
      );
      return {
        inputFocusVisible: element.matches(":focus-visible"),
        labelOutlineStyle: labelStyles?.outlineStyle ?? "",
        labelOutlineWidth: labelStyles?.outlineWidth ?? "",
        labelOutlineColor: labelStyles?.outlineColor ?? "",
        selected: row?.getAttribute("aria-selected"),
        rowBoundary: rowBoundary
          ? getComputedStyle(rowBoundary, "::after").content
          : "",
      };
    });
    expect(keyboardSelection.inputFocusVisible).toBe(true);
    expect(keyboardSelection.labelOutlineStyle).toBe("solid");
    expect(keyboardSelection.labelOutlineWidth).toBe("2px");
    expect(keyboardSelection.labelOutlineColor).not.toBe("transparent");
    expect(keyboardSelection.selected).toBeNull();
    expect(keyboardSelection.rowBoundary).toBe("none");

    const search = page.getByTestId("search-input");
    await search.click();
    const textEntry = await search.evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        borderColor: styles.borderColor,
        boxShadow: styles.boxShadow,
        ringColor: styles.getPropertyValue("--tw-ring-color").trim(),
      };
    });
    expect(textEntry.borderColor).not.toBe("transparent");
    expect(textEntry.boxShadow).toContain("2px");
    expect(textEntry.boxShadow).toContain("inset");
    expect(textEntry.ringColor).not.toBe("");
    expect(textEntry.ringColor).not.toBe("transparent");

    // A pointer activation of a regular control must not flash its keyboard
    // ring; the next real Tab must restore the same solid brand treatment.
    await page.getByTestId("view-switcher-board").click();
    const pointerButton = await page
      .getByTestId("view-switcher-board")
      .evaluate((element) => {
        const styles = getComputedStyle(element);
        return {
          focusVisible: element.matches(":focus-visible"),
          boxShadow: styles.boxShadow,
        };
      });
    expect(pointerButton.focusVisible).toBe(false);
    expect(pointerButton.boxShadow).toBe("none");

    await page.keyboard.press("Tab");
    const keyboardButton = await page
      .getByTestId("view-switcher-list")
      .evaluate((element) => {
        const styles = getComputedStyle(element);
        return {
          focusVisible: element.matches(":focus-visible"),
          boxShadow: styles.boxShadow,
          ringColor: styles.getPropertyValue("--tw-ring-color").trim(),
        };
      });
    expect(keyboardButton.focusVisible).toBe(true);
    expect(keyboardButton.boxShadow).toContain("2px");
    expect(keyboardButton.ringColor).not.toBe("");
  });

  test("restores focus to Board and List issue openers after dismissing detail", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=board`);
    const boardCard = page
      .locator('[data-testid="kanban-card"]')
      .filter({ hasText: "Initial issue Alpha" });
    await expect(boardCard).toBeVisible({ timeout: 15_000 });
    await expect(boardCard).not.toBeFocused();
    await boardCard.click();
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await page.getByTestId("issue-close").click();
    await expect(page.getByTestId("issue-detail")).toHaveCount(0);
    await expect(boardCard).toBeFocused();

    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=board`);
    const keyboardBoardCard = page
      .locator('[data-testid="kanban-card"]')
      .filter({ hasText: "Initial issue Alpha" });
    await expect(keyboardBoardCard).toBeVisible({ timeout: 15_000 });
    await keyboardBoardCard.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await page.getByTestId("issue-close").click();
    await expect(page.getByTestId("issue-detail")).toHaveCount(0);
    await expect(keyboardBoardCard).toBeFocused();

    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);
    const listRow = page
      .locator('[data-testid="issue-list-row"]')
      .filter({ hasText: "Initial issue Alpha" });
    await expect(listRow).toBeVisible({ timeout: 15_000 });
    await expect(listRow).not.toBeFocused();
    await listRow.locator('td[data-column-key="title"]').click();
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await page.getByTestId("issue-close").click();
    await expect(page.getByTestId("issue-detail")).toHaveCount(0);
    await expect(listRow).toBeFocused();

    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);
    const keyboardListRow = page
      .locator('[data-testid="issue-list-row"]')
      .filter({ hasText: "Initial issue Alpha" });
    await expect(keyboardListRow).toBeVisible({ timeout: 15_000 });
    await keyboardListRow.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("issue-detail")).toHaveCount(0);
    await expect(keyboardListRow).toBeFocused();
  });

  test("does not hijack Enter from focused issue-page controls", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");

    const rows = await expectIssueListKeyboardReady(page);
    await page.keyboard.press("j");
    await expect(rows.first()).toHaveAttribute("data-keyboard-focused", "true");

    await page.getByTestId("view-switcher-board").focus();
    await page.keyboard.press("Enter");

    await page.waitForURL(/\/issues\?view=board/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-detail"]')).toHaveCount(0);
  });

  test("opens row-anchored status quick edit with s and PATCHes through the Route Handler", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");

    const rows = await expectIssueListKeyboardReady(page);
    const row = rows.filter({ hasText: "REEF-001" }).first();
    await expect(row).toBeVisible();
    await row.focus();
    await expect(row).toHaveAttribute("data-keyboard-focused", "true");

    const patch = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        response.request().method() === "PATCH" &&
        url.pathname === "/api/issues/REEF-001"
      );
    });

    await page.keyboard.press("s");
    await expect(
      page.locator('[data-testid="issue-quick-edit-status"]'),
    ).toBeVisible();
    await page.getByRole("option", { name: "In Progress" }).click();
    await patch;

    await expect
      .poll(() => issueStatus(request, "REEF-001"))
      .toBe("in_progress");
    await expect(row).toContainText("In Progress");
  });

  test("keeps each List quick editor beside its activated field without opening detail", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");

    const rows = await expectIssueListKeyboardReady(page);
    const row = rows.first();

    for (const field of ["status", "priority", "assignee"] as const) {
      await row.getByTestId(`issue-inline-edit-${field}`).click();
      const anchor = page.getByTestId("issue-quick-edit-anchor");
      await expect(anchor).toBeVisible();
      await expect(page.locator('[data-testid="issue-detail"]')).toHaveCount(0);

      const geometry = await page.evaluate((fieldName) => {
        const trigger = document.querySelector<HTMLElement>(
          `[data-testid="issue-inline-edit-${fieldName}"]`,
        );
        const editor = document.querySelector<HTMLElement>(
          '[data-testid="issue-quick-edit-anchor"]',
        );
        if (!trigger || !editor) throw new Error("quick-edit geometry missing");
        const triggerRect = trigger.getBoundingClientRect();
        return {
          triggerLeft: triggerRect.left,
          triggerCenter: triggerRect.top + triggerRect.height / 2,
          editorLeft: Number.parseFloat(editor.style.left),
          editorCenter: Number.parseFloat(editor.style.top),
        };
      }, field);

      expect(geometry.editorLeft).toBeCloseTo(geometry.triggerLeft, 0);
      expect(geometry.editorCenter).toBeCloseTo(geometry.triggerCenter, 0);

      const widths = await page.evaluate((fieldName) => {
        const editor = document.querySelector<HTMLElement>(
          '[data-testid="issue-quick-edit-anchor"]',
        );
        const content =
          fieldName === "assignee"
            ? document
                .querySelector<HTMLElement>(
                  '[data-testid="assignee-combobox"] [role="listbox"]',
                )
                ?.closest<HTMLElement>('[role="dialog"]')
            : document.querySelector<HTMLElement>(
                '[data-slot="select-content"]',
              );
        if (!editor || !content) throw new Error("quick-edit width missing");
        return {
          editor: editor.getBoundingClientRect().width,
          content: content.getBoundingClientRect().width,
        };
      }, field);

      if (field === "assignee") {
        expect(widths.editor).toBe(224);
        expect(widths.content).toBeGreaterThanOrEqual(256);
      } else {
        expect(widths.editor).toBe(192);
        expect(widths.content).toBe(192);
      }

      const editorTrigger =
        field === "assignee"
          ? page.getByTestId("assignee-combobox").locator("button").first()
          : page.getByTestId(`issue-quick-edit-${field}`);
      if (field === "assignee") {
        await page.keyboard.press("Escape");
      } else {
        await editorTrigger.press("Escape");
      }
      await expect(anchor).toHaveCount(0);
    }
  });

  test("returns focus to the List trigger after canceling a quick edit", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");

    const rows = await expectIssueListKeyboardReady(page);
    const row = rows.filter({ hasText: "Initial issue Alpha" });
    const trigger = row.getByTestId("issue-inline-edit-priority");
    await trigger.focus();
    await trigger.press("Enter");

    const editor = page.getByTestId("issue-quick-edit-priority");
    await expect(editor).toBeVisible();
    await editor.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("collision-places the narrow List Priority editor inside a 640px viewport", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    // Keep Alpha as the first rendered row so the collision check exercises the
    // narrow editor's viewport placement rather than the fixed Ask AI FAB
    // overlapping a lower row in a 360px-tall viewport. Manual rank remains
    // covered by the surrounding List interaction tests.
    await page.goto("/workspace/reef-e2e/issues?view=list&sort=priority");
    await page.setViewportSize({ width: 640, height: 360 });

    const rows = await expectIssueListKeyboardReady(page);
    const row = rows.filter({ hasText: "Initial issue Alpha" });
    await row.getByTestId("issue-inline-edit-priority").click();

    const content = page.locator('[data-slot="select-content"]');
    await expect(content).toBeVisible();
    const geometry = await content.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const anchor = document.querySelector<HTMLElement>(
        '[data-testid="issue-quick-edit-anchor"]',
      );
      const anchorRect = anchor?.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        anchorLeft: anchorRect?.left,
        anchorRight: anchorRect?.right,
      };
    });

    expect(geometry.width).toBe(192);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(640);
    expect(geometry.anchorLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.anchorRight).toBeLessThanOrEqual(640);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("issue-quick-edit-anchor")).toHaveCount(0);
  });

  test("keeps List selection and row context chrome through pointer menus", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");

    const rows = await expectIssueListKeyboardReady(page);
    const selectedRow = rows.filter({ hasText: "Initial issue Alpha" });
    const unselectedRow = rows.filter({ hasText: "Initial issue Beta" });
    await expect(selectedRow).toBeVisible();
    await expect(unselectedRow).toBeVisible();

    await selectedRow.getByTestId("issue-row-checkbox").click();
    await expect(selectedRow).toHaveAttribute("aria-selected", "true");
    await expect(
      page.locator('[data-testid="issue-list-row"][aria-selected="true"]'),
    ).toHaveCount(1);

    await selectedRow.click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(selectedRow).toHaveAttribute("data-context-open", "true");
    await expect(selectedRow).toHaveAttribute("aria-selected", "true");
    await expect(
      page.locator('[data-testid="issue-list-row"][aria-selected="true"]'),
    ).toHaveCount(1);

    const selectedChrome = await selectedRow.evaluate((row) => {
      const stickyId = row.querySelector<HTMLElement>(
        'td[data-column-key="id"]',
      );
      return {
        rowClass: row.className,
        stickyClass: stickyId?.className ?? "",
      };
    });
    expect(selectedChrome.rowClass).toContain("bg-brand-fill/5");
    expect(selectedChrome.rowClass).not.toContain("hover:bg-surface-hover");
    expect(selectedChrome.stickyClass).toContain("reef-list-sticky-state");
    expect(selectedChrome.stickyClass).not.toContain(
      "group-hover:bg-surface-hover",
    );

    const copyLink = menu.getByTestId("issue-context-menu-copy-link");
    await copyLink.hover();
    await expect(copyLink).toHaveAttribute("data-highlighted");
    await expect(selectedRow).toHaveAttribute("data-context-open", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(selectedRow).not.toHaveAttribute("data-context-open", "true");

    await unselectedRow.click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(unselectedRow).toHaveAttribute("data-context-open", "true");
    await expect(unselectedRow).not.toHaveAttribute("aria-selected");
    await expect(
      page.locator('[data-testid="issue-list-row"][aria-selected="true"]'),
    ).toHaveCount(1);
    await expect(unselectedRow).toHaveClass(/hover:bg-transparent/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(unselectedRow).not.toHaveAttribute(
      "data-context-open",
      "true",
    );
  });

  test("keeps List selection and row context chrome through pointer and keyboard menus", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");

    const rows = await expectIssueListKeyboardReady(page);
    const selectedRow = rows.filter({ hasText: "Initial issue Alpha" });
    const unselectedRow = rows.filter({ hasText: "Initial issue Beta" });
    await selectedRow.getByTestId("issue-row-checkbox").click();
    await expect(selectedRow).toHaveAttribute("aria-selected", "true");

    await unselectedRow.focus();
    await expect(unselectedRow).toBeFocused();
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(unselectedRow).toHaveAttribute("data-context-open", "true");
    await expect(unselectedRow).not.toHaveAttribute("aria-selected");
    await expect(
      page.locator('[data-testid="issue-list-row"][aria-selected="true"]'),
    ).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(unselectedRow).toBeFocused();
    await expect(unselectedRow).not.toHaveAttribute(
      "data-context-open",
      "true",
    );
  });

  test("keeps the selected List row reachable at an effective 200% viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");

    const rows = await expectIssueListKeyboardReady(page);
    const selectedRow = rows.filter({ hasText: "Initial issue Alpha" });
    await expect(selectedRow).toBeVisible();
    await selectedRow.getByTestId("issue-row-checkbox").click();
    await expect(selectedRow).toHaveAttribute("aria-selected", "true");

    await selectedRow.focus();
    await expect(selectedRow).toBeFocused();
    await expect(selectedRow).toHaveAttribute("data-keyboard-focused", "true");
    const selectedFocusBoundary = await selectedRow.evaluate((row) => {
      const boundary = row.querySelector<HTMLElement>(
        'td[data-column-key="select"]',
      );
      return boundary ? getComputedStyle(boundary, "::after").content : "";
    });
    expect(selectedFocusBoundary).not.toBe("none");

    const geometry = await selectedRow.evaluate((row) => {
      const rowRect = row.getBoundingClientRect();
      const scroll = row.closest<HTMLElement>(
        '[data-testid="issue-list-scroll-container"]',
      );
      const scrollRect = scroll?.getBoundingClientRect();
      const checkbox = row.querySelector<HTMLElement>(
        '[data-testid="issue-row-checkbox"]',
      );
      const checkboxRect = checkbox?.getBoundingClientRect();
      return {
        rowTop: rowRect.top,
        rowBottom: rowRect.bottom,
        scrollTop: scrollRect?.top ?? 0,
        scrollBottom: scrollRect?.bottom ?? 0,
        checkboxTop: checkboxRect?.top ?? 0,
        checkboxBottom: checkboxRect?.bottom ?? 0,
        scrollHeight: scroll?.scrollHeight ?? 0,
        clientHeight: scroll?.clientHeight ?? 0,
        mountedRows:
          scroll?.querySelectorAll('[data-testid="issue-list-row"]').length ??
          0,
      };
    });

    expect(geometry.clientHeight).toBeGreaterThan(0);
    expect(geometry.clientHeight).toBeLessThanOrEqual(360);
    expect(geometry.mountedRows).toBeLessThanOrEqual(50);
    expect(geometry.rowTop).toBeGreaterThanOrEqual(geometry.scrollTop);
    expect(geometry.rowBottom).toBeLessThanOrEqual(geometry.scrollBottom);
    expect(geometry.checkboxTop).toBeGreaterThanOrEqual(geometry.scrollTop);
    expect(geometry.checkboxBottom).toBeLessThanOrEqual(geometry.scrollBottom);

    await page.locator("main").evaluate((element) => {
      const main = element as HTMLElement;
      main.scrollTop = main.scrollHeight;
    });
    await page.waitForTimeout(50);
    const viewportGeometry = await selectedRow.evaluate((row) => {
      const rect = row.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });
    expect(viewportGeometry.top).toBeGreaterThanOrEqual(0);
    expect(viewportGeometry.bottom).toBeLessThanOrEqual(360);

    await selectedRow.click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(selectedRow).toHaveAttribute("data-context-open", "true");
  });

  test("keeps an unselected context target and menu usable at an effective 200% viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");

    const rows = await expectIssueListKeyboardReady(page);
    const selectedRow = rows.filter({ hasText: "Initial issue Alpha" });
    const targetRow = rows.filter({ hasText: "Initial issue Beta" });
    await selectedRow.getByTestId("issue-row-checkbox").click();
    await expect(selectedRow).toHaveAttribute("aria-selected", "true");

    await page.locator("main").evaluate((element) => {
      const main = element as HTMLElement;
      main.scrollTop = main.scrollHeight;
    });
    await page.waitForTimeout(50);
    const targetGeometry = await targetRow.evaluate((row) => {
      const rect = row.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });
    expect(targetGeometry.top).toBeGreaterThanOrEqual(0);
    expect(targetGeometry.bottom).toBeLessThanOrEqual(360);

    await targetRow.click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(targetRow).toHaveAttribute("data-context-open", "true");
    await expect(targetRow).not.toHaveAttribute("aria-selected");
    await expect(
      page.locator('[data-testid="issue-list-row"][aria-selected="true"]'),
    ).toHaveCount(1);

    const menuGeometry = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });
    expect(menuGeometry.top).toBeGreaterThanOrEqual(0);
    expect(menuGeometry.bottom).toBeLessThanOrEqual(360);
    await expect(menu.getByRole("menuitem").first()).toBeVisible();
  });

  test("keeps List text separated after horizontal scrolling at an effective 200% viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");

    const rows = await expectIssueListKeyboardReady(page);
    const row = rows.filter({ hasText: "Initial issue Alpha" });
    const scroll = page.getByTestId("issue-list-scroll-container");
    await expect(row).toBeVisible();
    await expect
      .poll(async () =>
        scroll.evaluate((element) => element.scrollWidth > element.clientWidth),
      )
      .toBe(true);

    const textRects = async () =>
      row.evaluate((element) => {
        const root = element.closest<HTMLElement>(
          '[data-testid="issue-list-scroll-container"]',
        );
        if (!root) throw new Error("missing List scroll container");
        const rootRect = root.getBoundingClientRect();
        const rangeRect = (column: string) => {
          const cell = element.querySelector<HTMLElement>(
            `td[data-column-key="${column}"]`,
          );
          if (!cell) throw new Error(`missing ${column} cell`);
          const range = document.createRange();
          range.selectNodeContents(cell);
          const rect = range.getBoundingClientRect();
          const cellRect = cell.getBoundingClientRect();
          return {
            left: Math.max(rect.left, cellRect.left, rootRect.left),
            right: Math.min(rect.right, cellRect.right, rootRect.right),
          };
        };
        return {
          title: rangeRect("title"),
          status: rangeRect("status"),
          priority: rangeRect("priority"),
        };
      });

    await scroll.evaluate((element) => {
      const root = element as HTMLElement;
      root.scrollLeft = Math.min(600, root.scrollWidth);
      root.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(50);
    const after = await textRects();
    const separated = (
      first: { left: number; right: number },
      second: { left: number; right: number },
    ) => first.right <= second.left || second.right <= first.left;
    for (const range of Object.values(after)) {
      expect(range.right).toBeGreaterThan(range.left);
    }
    expect(separated(after.title, after.status)).toBe(true);
    expect(separated(after.status, after.priority)).toBe(true);
  });

  test("keeps the sticky List boundary opaque at the right horizontal extreme", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");

    const rows = await expectIssueListKeyboardReady(page);
    const selectedRow = rows.filter({ hasText: "Initial issue Alpha" });
    const unselectedRow = rows.filter({ hasText: "Initial issue Beta" });
    const scroll = page.getByTestId("issue-list-scroll-container");
    await selectedRow.getByTestId("issue-row-checkbox").click();
    await expect(selectedRow).toHaveAttribute("aria-selected", "true");

    const boundary = async (row: typeof selectedRow) =>
      row.evaluate((element) => {
        const stickyColumns = ["select", "id", "type", "title"];
        const rect = (column: string) => {
          const cell = element.querySelector<HTMLElement>(
            `td[data-column-key="${column}"]`,
          );
          if (!cell) throw new Error(`missing ${column} cell`);
          const bounds = cell.getBoundingClientRect();
          return {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
          };
        };
        const sticky = stickyColumns.map((column) => {
          const cell = element.querySelector<HTMLElement>(
            `td[data-column-key="${column}"]`,
          );
          if (!cell) throw new Error(`missing sticky ${column} cell`);
          const background = getComputedStyle(cell).backgroundColor;
          const alpha = background.match(/\/\s*([\d.]+)\)?$/u);
          return {
            column,
            background,
            alpha: alpha ? Number(alpha[1]) : 1,
            zIndex: getComputedStyle(cell).zIndex,
            rect: rect(column),
          };
        });
        const boundaryCell = element.querySelector<HTMLElement>(
          'td[data-column-key="select"]',
        );
        const titleCell = element.querySelector<HTMLElement>(
          'td[data-column-key="title"]',
        );
        if (!boundaryCell || !titleCell) {
          throw new Error("missing row boundary cells");
        }
        const scrollRoot = element.closest<HTMLElement>(
          '[data-testid="issue-list-scroll-container"]',
        );
        if (!scrollRoot) {
          throw new Error("missing List scroll container");
        }
        const pseudo = getComputedStyle(boundaryCell, "::after");
        const boundaryRect = boundaryCell.getBoundingClientRect();
        const scrollRect = scrollRoot.getBoundingClientRect();
        const pseudoLeft = Number.parseFloat(pseudo.left);
        const pseudoWidth = Number.parseFloat(pseudo.width);
        const overlaps = ["status", "assignee"].map((column) => {
          const ordinary = rect(column);
          return {
            column,
            overlap: sticky.some(
              ({ rect: stickyRect }) =>
                stickyRect.left < ordinary.right &&
                ordinary.left < stickyRect.right &&
                stickyRect.top < ordinary.bottom &&
                ordinary.top < stickyRect.bottom,
            ),
          };
        });
        return {
          sticky,
          overlaps,
          activeBoundary: {
            content: pseudo.content,
            borderTopStyle: pseudo.borderTopStyle,
            borderTopWidth: pseudo.borderTopWidth,
            selectZIndex: Number(getComputedStyle(boundaryCell).zIndex),
            titleZIndex: Number(getComputedStyle(titleCell).zIndex),
            left: boundaryRect.left + pseudoLeft,
            right: boundaryRect.left + pseudoLeft + pseudoWidth,
            viewportLeft: scrollRect.left,
            viewportRight: scrollRect.right,
          },
        };
      });

    const assertContextBoundary = (
      snapshot: Awaited<ReturnType<typeof boundary>>,
    ) => {
      expect(snapshot.activeBoundary.content).not.toBe("none");
      expect(snapshot.activeBoundary.borderTopStyle).toBe("solid");
      expect(snapshot.activeBoundary.borderTopWidth).toBe("2px");
      expect(snapshot.activeBoundary.selectZIndex).toBeGreaterThan(
        snapshot.activeBoundary.titleZIndex,
      );
      expect(snapshot.activeBoundary.left).toBeLessThanOrEqual(
        snapshot.activeBoundary.viewportLeft + 1,
      );
      expect(snapshot.activeBoundary.right).toBeGreaterThanOrEqual(
        snapshot.activeBoundary.viewportRight - 1,
      );
    };

    const assertSelectedStateHasNoRowBoundary = (
      snapshot: Awaited<ReturnType<typeof boundary>>,
    ) => {
      // Pointer selection owns a fill and the checkbox owns keyboard focus;
      // there must be no row-sized pseudo-boundary in this state.
      expect(snapshot.activeBoundary.content).toBe("none");
    };

    await scroll.evaluate((element) => {
      const root = element as HTMLElement;
      root.scrollLeft = 0;
      root.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(50);
    const selectedLeftBoundary = await boundary(selectedRow);
    assertSelectedStateHasNoRowBoundary(selectedLeftBoundary);

    await scroll.evaluate((element) => {
      const root = element as HTMLElement;
      root.scrollLeft = root.scrollWidth;
      root.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(50);

    const selectedBoundary = await boundary(selectedRow);
    const unselectedBoundary = await boundary(unselectedRow);
    assertSelectedStateHasNoRowBoundary(selectedBoundary);
    expect(selectedBoundary.overlaps).toEqual([
      { column: "status", overlap: true },
      { column: "assignee", overlap: true },
    ]);
    expect(unselectedBoundary.overlaps).toEqual([
      { column: "status", overlap: true },
      { column: "assignee", overlap: true },
    ]);
    for (const cell of [
      ...selectedBoundary.sticky,
      ...unselectedBoundary.sticky,
    ]) {
      expect(cell.alpha).toBe(1);
      expect(cell.zIndex).not.toBe("auto");
    }

    await unselectedRow.click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    const unselectedContextBoundary = await boundary(unselectedRow);
    assertContextBoundary(unselectedContextBoundary);
    await page.keyboard.press("Escape");
  });

  test("moves Backlog focus with j, exposes semantic links, and opens the focused issue", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?scope=backlog&view=list");

    const row = page.getByTestId("backlog-row").filter({ hasText: "REEF-003" });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toHaveAttribute("tabindex", "0");

    await page.keyboard.press("j");
    await expect(row).toHaveAttribute("data-keyboard-focused", "true");
    await expect(row).toBeFocused();
    await expect(row.getByRole("link", { name: "REEF-003" })).toHaveAttribute(
      "href",
      "/workspace/reef-e2e/issues/REEF-003?scope=backlog&view=list",
    );
    await expect(row.getByTestId("issue-inline-edit-status")).toHaveAttribute(
      "aria-label",
      "Status",
    );
    await expect(row.getByTestId("backlog-grip-REEF-003")).toHaveAttribute(
      "aria-label",
      "Reorder REEF-003",
    );

    await page.keyboard.press("Enter");
    await page.waitForURL(/\/issues\/REEF-003\?scope=backlog&view=list/, {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
  });

  test("moves board focus with arrows and opens the focused card with Enter", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=board");
    await page.bringToFront();

    const alpha = page
      .locator('[data-testid="kanban-card"]')
      .filter({ hasText: "Initial issue Alpha" });
    const beta = page
      .locator('[data-testid="kanban-card"]')
      .filter({ hasText: "Initial issue Beta" });
    await expect(alpha).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press("ArrowDown");
    await expect(alpha).toHaveAttribute("data-keyboard-focused", "true");
    await expect(alpha).toBeFocused();
    await expectFocusedGeometryStable(alpha);
    await page.keyboard.press("j");
    await expect(beta).toBeFocused();
    await expect(beta).toHaveAttribute("data-keyboard-focused", "true");

    await page.keyboard.press("Enter");
    await page.waitForURL(/\/issues\/REEF-002\?view=board/, {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
  });

  test("honors typing and IME guards while g-chord navigation stays timed", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");

    const rows = await expectIssueListKeyboardReady(page);

    await page.locator('[data-testid="search-input"]').focus();
    await page.evaluate(() => {
      const input = document.querySelector('[data-testid="search-input"]');
      if (!input) throw new Error("missing search input");
      const event = new KeyboardEvent("keydown", {
        key: "j",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "isComposing", { value: true });
      input.dispatchEvent(event);
    });
    await expect(rows.first()).not.toHaveAttribute(
      "data-keyboard-focused",
      "true",
    );
    await page
      .locator('[data-testid="search-input"]')
      .evaluate((node) => (node as HTMLInputElement).blur());

    await page.keyboard.press("g");
    await page.waitForTimeout(850);
    await page.keyboard.press("i");
    await expect(page).toHaveURL(/\/issues\?view=list/);

    await page.keyboard.press("g");
    await page.keyboard.press("b");
    await page.waitForURL(/\/issues\?scope=backlog&view=list/, {
      timeout: 10_000,
    });

    for (const [key, pattern, heading] of [
      ["i", /\/issues$/, "Issues"],
      ["m", /\/my-work$/, "My Work"],
      ["r", /\/reports$/, "Reports"],
    ] as const) {
      await page.keyboard.press("g");
      await page.keyboard.press(key);
      await page.waitForURL(pattern, { timeout: 10_000 });
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
  });
});
