import { type Page, expect, test } from "@playwright/test";
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

    await page.keyboard.press("Enter");
    await page.waitForURL(/\/issues\/REEF-001\?view=list/, {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
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
    await page.keyboard.press("j");
    await expect(rows.first()).toHaveAttribute("data-keyboard-focused", "true");

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
    await expect(rows.first()).toContainText("In Progress");
  });

  test("moves Backlog focus with j, exposes semantic links, and opens the focused issue", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=backlog");

    const row = page.getByTestId("backlog-row").filter({ hasText: "REEF-003" });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toHaveAttribute("tabindex", "0");

    await page.keyboard.press("j");
    await expect(row).toHaveAttribute("data-keyboard-focused", "true");
    await expect(row).toBeFocused();
    await expect(row.getByRole("link", { name: "REEF-003" })).toHaveAttribute(
      "href",
      "/workspace/reef-e2e/issues/REEF-003?view=backlog",
    );
    await expect(
      row.getByTestId("backlog-status-select-REEF-003"),
    ).toHaveAttribute("aria-label", "Change REEF-003 status");
    await expect(row.getByTestId("backlog-grip-REEF-003")).toHaveAttribute(
      "aria-label",
      "Reorder REEF-003",
    );

    await page.keyboard.press("Enter");
    await page.waitForURL(/\/issues\/REEF-003\?view=backlog/, {
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
    // The focus effect commits on the next task after ArrowDown. Let that
    // commit settle before dispatching the following shortcut key.
    await page.evaluate(
      () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    );
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
    await page.waitForURL(/\/issues\?view=backlog/, { timeout: 10_000 });

    for (const [key, pattern, heading] of [
      ["i", /\/issues$/, "Issues"],
      ["m", /\/my-work$/, "My Work"],
      ["s", /\/suggestions$/, "Suggestions to review"],
      ["r", /\/reports$/, "Reports"],
    ] as const) {
      await page.keyboard.press("g");
      await page.keyboard.press(key);
      await page.waitForURL(pattern, { timeout: 10_000 });
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
  });
});
