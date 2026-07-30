import { expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

const searchInput = '[data-testid="global-search-input"]';
const commandInput = '[data-testid="command-palette-input"]';

async function enterCommandMode(page: import("@playwright/test").Page) {
  await expect(page.locator("[data-interaction-ready=true]")).toBeVisible();
  await page.keyboard.press("Control+K");
  await page.locator(searchInput).fill(">");
  await expect(page.locator(commandInput)).toBeFocused();
}

test.describe("Hermetic command palette", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("keeps Commands above recent issues and performs no issue search in command mode", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.keyboard.press("Control+K");

    const commands = page.getByTestId("command-mode-entry");
    const recent = page.getByTestId("global-search-item").first();
    await expect(commands).toBeVisible();
    await expect(recent).toBeVisible();
    expect(
      await commands.evaluate(
        (node, other) =>
          Boolean(
            node.compareDocumentPosition(other as Node) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        await recent.elementHandle(),
      ),
    ).toBe(true);

    let metadataSearches = 0;
    let contentSearches = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/issues" && url.searchParams.has("q")) {
        metadataSearches += 1;
      }
      if (url.pathname === "/api/issues/search-content") {
        contentSearches += 1;
      }
    });

    await page.locator(searchInput).fill(">view");
    await expect(page.locator(commandInput)).toHaveValue("view");
    await page.waitForTimeout(500);
    expect(metadataSearches).toBe(0);
    expect(contentSearches).toBe(0);
  });

  test("supports nested keyboard navigation and preserves issue query state when changing view", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(
      "/workspace/reef-e2e/issues?view=board&q=Alpha&sort=priority",
    );
    await enterCommandMode(page);

    await page
      .locator('[data-testid="command-page-entry"][data-command-page="view"]')
      .click();
    await expect(page.getByTestId("command-breadcrumb")).toContainText(
      "Change view",
    );
    await page.keyboard.press("Escape");
    await expect(
      page.locator(
        '[data-testid="command-page-entry"][data-command-page="view"]',
      ),
    ).toBeVisible();

    await page
      .locator('[data-testid="command-page-entry"][data-command-page="view"]')
      .click();
    await page.locator(commandInput).press("Backspace");
    await expect(
      page.locator(
        '[data-testid="command-page-entry"][data-command-page="view"]',
      ),
    ).toBeVisible();

    await page
      .locator('[data-testid="command-page-entry"][data-command-page="view"]')
      .click();
    await page
      .locator('[data-testid="command-action"][data-command-id="view.list"]')
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("view"))
      .toBe("list");
    const route = new URL(page.url());
    expect(route.searchParams.get("view")).toBe("list");
    expect(route.searchParams.get("q")).toBe("Alpha");
    expect(route.searchParams.get("sort")).toBe("priority");
  });

  test("hands focus to the existing New issue dialog", async ({ page }) => {
    await openExistingWorkspace(page);
    await enterCommandMode(page);

    await page
      .locator('[data-testid="command-action"][data-command-id="issue.new"]')
      .click();
    const dialog = page.getByTestId("new-issue-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("input").first()).toBeFocused();
  });

  test("fuzzy-matches localized English and Korean aliases", async ({
    context,
    page,
  }) => {
    await openExistingWorkspace(page);
    await enterCommandMode(page);
    await page.locator(commandInput).fill("kanban");
    await expect(
      page.locator(
        '[data-testid="command-action"][data-command-id="view.board"]',
      ),
    ).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page.locator(commandInput)).toBeHidden();
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "ko", url: "http://localhost:7353" },
    ]);
    await page.reload();
    await enterCommandMode(page);
    await page.locator(commandInput).fill("칸반");
    await expect(
      page.locator(
        '[data-testid="command-action"][data-command-id="view.board"]',
      ),
    ).toBeVisible();
  });

  test("restores focus after a same-surface theme command", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    const origin = page.getByTestId("sidebar-shortcuts-trigger");
    await origin.focus();
    await enterCommandMode(page);
    await page
      .locator('[data-testid="command-page-entry"][data-command-page="theme"]')
      .click();
    await page
      .locator('[data-testid="command-action"][data-command-id="theme.dark"]')
      .click();

    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(origin).toBeFocused();
  });

  test("targets a detail issue, skips same-value PATCH, and requires a close reason", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const patches: Array<Record<string, unknown>> = [];
    page.on("request", async (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "PATCH" &&
        url.pathname === "/api/issues/REEF-001"
      ) {
        patches.push(request.postDataJSON() as Record<string, unknown>);
      }
    });

    await enterCommandMode(page);
    const statusPage = page.locator(
      '[data-testid="command-page-entry"][data-command-page="status"]',
    );
    await expect(statusPage).toContainText("REEF-001");
    await statusPage.click();
    await page
      .locator('[data-testid="command-action"][data-command-id="status.todo"]')
      .click();
    await page.waitForTimeout(300);
    expect(patches).toHaveLength(0);

    await enterCommandMode(page);
    await page
      .locator('[data-testid="command-page-entry"][data-command-page="status"]')
      .click();
    await page
      .locator(
        '[data-testid="command-action"][data-command-id="status.closed"]',
      )
      .click();
    await expect(page.getByTestId("close-issue-dialog")).toBeVisible();
    expect(patches).toHaveLength(0);

    await page.getByTestId("close-issue-confirm").click();
    await expect
      .poll(() =>
        patches.some(
          (body) =>
            (body.update as { patch?: { status?: string } } | undefined)?.patch
              ?.status === "closed",
        ),
      )
      .toBe(true);
  });

  test("PATCHes priority and assignee through their existing mutation path", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const patches: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "PATCH" &&
        url.pathname === "/api/issues/REEF-001"
      ) {
        const body = request.postDataJSON() as {
          update?: { patch?: Record<string, unknown> };
        };
        patches.push(body.update?.patch ?? {});
      }
    });

    await enterCommandMode(page);
    await page
      .locator(
        '[data-testid="command-page-entry"][data-command-page="priority"]',
      )
      .click();
    await page
      .locator(
        '[data-testid="command-action"][data-command-id="priority.medium"]',
      )
      .click();
    await expect
      .poll(() => patches.some((patch) => patch.priority === "medium"))
      .toBe(true);

    await enterCommandMode(page);
    await page
      .locator(
        '[data-testid="command-page-entry"][data-command-page="assignee"]',
      )
      .click();
    await page.getByTestId("command-assignee-unassigned").click();
    await expect
      .poll(() => patches.some((patch) => patch.assigned_to === null))
      .toBe(true);
  });

  test("hides single-issue commands while list selection is active", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");
    const row = page.getByTestId("issue-list-row").first();
    await expect(row).toBeVisible();
    await row.getByRole("checkbox").click();
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await enterCommandMode(page);

    for (const pageName of ["status", "assignee", "priority"]) {
      await expect(
        page.locator(
          `[data-testid="command-page-entry"][data-command-page="${pageName}"]`,
        ),
      ).toHaveCount(0);
    }
  });
});
