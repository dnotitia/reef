import { expect, test } from "../harness/test";
import { openExistingWorkspace, resetFixture } from "../harness/fixture";

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

    const metadataResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        url.pathname === "/api/issues" &&
        url.searchParams.get("q") === "Alpha"
      );
    });
    await page.locator(searchInput).fill("Alpha");
    await metadataResponse;
    metadataSearches = 0;
    contentSearches = 0;
    await page.locator(searchInput).evaluate((input) => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setValue) throw new Error("missing input value setter");
      for (const value of ["", ">view"]) {
        setValue.call(input, value);
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
    });
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

    const newIssue = page.locator(
      '[data-testid="command-action"][data-command-id="issue.new"]',
    );
    await expect(newIssue).toContainText("New issue");
    await expect(newIssue).toHaveAccessibleName(/New issue/i);
    await newIssue.click();
    const dialog = page.getByTestId("new-issue-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("input").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("main")).toBeFocused();
  });

  test("fuzzy-matches aliases from both locales regardless of the UI locale", async ({
    context,
    page,
  }) => {
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "ko", url: "http://localhost:7353" },
    ]);
    await openExistingWorkspace(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await enterCommandMode(page);
    await page.locator(commandInput).fill("theme");
    await expect(
      page.locator(
        '[data-testid="command-page-entry"][data-command-page="theme"]',
      ),
    ).toBeVisible();
    await page.locator(commandInput).fill("them");
    await expect(
      page.locator(
        '[data-testid="command-page-entry"][data-command-page="theme"]',
      ),
    ).toBeVisible();
    await page
      .locator('[data-testid="command-page-entry"][data-command-page="theme"]')
      .click();
    await page.locator(commandInput).fill("dark");
    await expect(
      page.locator(
        '[data-testid="command-action"][data-command-id="theme.dark"]',
      ),
    ).toBeVisible();

    await page
      .locator('[data-testid="command-action"][data-command-id="theme.dark"]')
      .click();
    await expect(page.locator(commandInput)).toBeHidden();
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "en", url: "http://localhost:7353" },
    ]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await enterCommandMode(page);
    await page.locator(commandInput).fill("테마");
    await expect(
      page.locator(
        '[data-testid="command-page-entry"][data-command-page="theme"]',
      ),
    ).toBeVisible();
    await page
      .locator('[data-testid="command-page-entry"][data-command-page="theme"]')
      .click();
    await page.locator(commandInput).fill("다");
    await expect(
      page.locator(
        '[data-testid="command-action"][data-command-id="theme.dark"]',
      ),
    ).toBeVisible();
  });

  test("pops an empty nested page with Backspace after pointer entry", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await enterCommandMode(page);

    const themePage = page.locator(
      '[data-testid="command-page-entry"][data-command-page="theme"]',
    );
    const box = await themePage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expect(page.getByTestId("command-breadcrumb")).toContainText(
      "Change theme",
    );
    await expect(page.locator(commandInput)).toBeFocused();
    await page.keyboard.press("Backspace");
    await expect(themePage).toBeVisible();
  });

  test("selects and executes the first filtered command result", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/planning");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await enterCommandMode(page);

    await page.locator(commandInput).fill("dark");
    const dark = page.locator(
      '[data-testid="command-action"][data-command-id="theme.dark"]',
    );
    await expect(dark).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('[cmdk-item][data-selected="true"]')
          .evaluateAll((items) =>
            items.map((item) => item.getAttribute("data-value")),
          ),
      )
      .toEqual(["theme.dark"]);
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/planning$/);
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("opens a contextual parent page through a real pointer coordinate", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    let patchCount = 0;
    page.on("request", (request) => {
      if (
        request.method() === "PATCH" &&
        new URL(request.url()).pathname === "/api/issues/REEF-001"
      ) {
        patchCount += 1;
      }
    });

    await enterCommandMode(page);
    const priorityPage = page.locator(
      '[data-testid="command-page-entry"][data-command-page="priority"]',
    );
    await priorityPage.scrollIntoViewIfNeeded();
    await expect(priorityPage).toBeVisible();
    const box = await priorityPage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const center = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
    await expect(priorityPage).toHaveAttribute("data-selected", "false");
    await page.mouse.move(center.x, center.y);
    await expect(priorityPage).toHaveAttribute("data-selected", "false");
    await page.mouse.click(center.x, center.y);

    await expect(page.locator(commandInput)).toBeVisible();
    await expect(page.getByTestId("command-breadcrumb")).toContainText(
      "Change priority",
    );
    await expect(
      page.locator(
        '[data-testid="command-action"][data-command-id="priority.high"]',
      ),
    ).toBeVisible();
    expect(patchCount).toBe(0);
  });

  test("restores meaningful focus after cancelling the root palette", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await expect(page.getByRole("main")).toBeFocused();
    await page.evaluate(() => {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        activeElement.blur();
      }
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await expect(page.locator("body")).toBeFocused();
    await enterCommandMode(page);

    await page.keyboard.press("Escape");
    await expect(page.locator(commandInput)).toBeHidden();
    await expect(page.getByRole("main")).toBeFocused();
  });

  test("moves focus to a meaningful destination control after navigation and locale changes", async ({
    context,
    page,
  }) => {
    await openExistingWorkspace(page);
    await enterCommandMode(page);
    await page
      .locator(
        '[data-testid="command-page-entry"][data-command-page="navigation"]',
      )
      .click();
    await page
      .locator(
        '[data-testid="command-action"][data-command-id="navigation.myWork"]',
      )
      .click();
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/my-work$/);
    await expect(page.getByRole("main")).toBeFocused();

    await context.addCookies([
      { name: "NEXT_LOCALE", value: "ko", url: "http://localhost:7353" },
    ]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await enterCommandMode(page);
    await page
      .locator('[data-testid="command-page-entry"][data-command-page="locale"]')
      .click();
    await page
      .locator('[data-testid="command-action"][data-command-id="locale.en"]')
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("main")).toBeFocused();
  });

  test("restores focus after a same-surface theme command", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await expect(page.getByRole("main")).toBeFocused();
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

  test("restores meaningful focus after a same-surface theme command without an origin control", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await expect(page.getByRole("main")).toBeFocused();
    await page.evaluate(() => {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        activeElement.blur();
      }
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await expect(page.locator("body")).toBeFocused();
    await enterCommandMode(page);
    await page
      .locator('[data-testid="command-page-entry"][data-command-page="theme"]')
      .click();
    await page
      .locator('[data-testid="command-action"][data-command-id="theme.dark"]')
      .click();

    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByRole("main")).toBeFocused();
  });

  test("marks the active issue view as current", async ({ page }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=board");
    await enterCommandMode(page);
    await page
      .locator('[data-testid="command-page-entry"][data-command-page="view"]')
      .click();

    const board = page.locator(
      '[data-testid="command-action"][data-command-id="view.board"]',
    );
    await expect(board.getByLabel("Current")).toBeVisible();
    await expect(
      page.locator('[data-testid="command-action"]').getByLabel("Current"),
    ).toHaveCount(1);
  });

  test("keeps a narrow nested breadcrumb visibly separated from the input", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await enterCommandMode(page);
    await page
      .locator(
        '[data-testid="command-page-entry"][data-command-page="assignee"]',
      )
      .click();

    const breadcrumb = page.getByTestId("command-breadcrumb");
    const input = page.locator(commandInput);
    await expect(breadcrumb).toContainText("Change assignee");
    await expect(input).toHaveAccessibleName("Search and commands");
    const separation = await breadcrumb.evaluate(
      (node, inputNode) => {
        const breadcrumbRect = node.getBoundingClientRect();
        const inputRect = (inputNode as HTMLElement).getBoundingClientRect();
        return inputRect.left - breadcrumbRect.right;
      },
      await input.elementHandle(),
    );
    expect(separation).toBeGreaterThanOrEqual(8);
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

    await page.keyboard.press("Control+K");
    await page.getByTestId("command-mode-entry").click();
    await page.locator(commandInput).fill("status");
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
    await row.hover();
    await row.getByRole("checkbox", { name: "Select REEF-001" }).click();
    await page.keyboard.press("Shift+Tab");
    await expect(row).toBeFocused();
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
