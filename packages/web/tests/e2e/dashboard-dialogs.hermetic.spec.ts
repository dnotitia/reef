import { type Page, expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

async function getNewIssueShortcutPress(page: Page) {
  return page.evaluate(() => {
    const nav = navigator as Navigator & {
      userAgentData?: { platform?: string };
    };
    const probe = `${nav.userAgentData?.platform ?? ""} ${nav.userAgent} ${
      nav.platform
    }`;
    if (/Firefox\//i.test(nav.userAgent)) {
      return /Mac|iPhone|iPad/i.test(probe) ? "Meta+Alt+N" : "Control+Alt+N";
    }
    return /Mac|iPhone|iPad/i.test(probe) ? "Meta+I" : "Control+I";
  });
}

test.describe("Hermetic dashboard surfaces and global dialogs", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("renders reports and activity read-only dashboard pages through Route Handlers", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/reports");
    await expect(page.locator('[data-testid="reports-page"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="report-scope-bar"]'),
    ).toBeVisible();
    await expect(page.getByText("Workflow")).toBeVisible();

    await page.goto("/workspace/reef-e2e/activity");
    await expect(page.locator('[data-testid="activity-feed"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="activity-scan-target-empty"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="activity-refresh"]'),
    ).toBeDisabled();
  });

  test("opens global search, shortcuts, Ask AI, and workspace dialogs from the dashboard shell", async ({
    context,
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");

    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible();
    const pagesBeforeNewIssueShortcut = context.pages().length;
    const unexpectedPage = context
      .waitForEvent("page", { timeout: 500 })
      .then(() => true)
      .catch(() => false);
    await page.keyboard.press(await getNewIssueShortcutPress(page));
    await expect(
      page.locator('[data-testid="new-issue-dialog"]'),
    ).toBeVisible();
    expect(await unexpectedPage).toBe(false);
    expect(context.pages()).toHaveLength(pagesBeforeNewIssueShortcut);
    await page.locator('[data-testid="new-issue-cancel"]').click();
    await expect(page.locator('[data-testid="new-issue-dialog"]')).toBeHidden();

    await page.keyboard.press("Control+K");
    await expect(
      page.locator('[data-testid="global-search-input"]'),
    ).toBeVisible();
    const searchResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        url.pathname === "/api/issues" &&
        url.searchParams.get("q") === "REEF-001"
      );
    });
    await page.locator('[data-testid="global-search-input"]').fill("REEF-001");
    await searchResponse;
    await expect(
      page.locator(
        '[data-testid="global-search-item"][data-issue-id="REEF-001"]',
      ),
    ).toBeVisible();
    // The palette silently ignores a click until its results are "current" for
    // the live query (debounce caught up, the response settled, and any exact-id
    // probe resolved). That readiness is mirrored on the results list as
    // `aria-busy="false"`; waiting on it — instead of a fixed 200ms sleep — makes
    // the click deterministic. Otherwise a slow render after the response lands
    // turns the click into a no-op and the navigation never happens (flaky).
    await expect(page.locator("[cmdk-list]")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await page
      .locator('[data-testid="global-search-item"][data-issue-id="REEF-001"]')
      .click();
    await page.waitForURL(/\/issues\/REEF-001/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await page.locator('[data-testid="issue-close"]').click();

    await page.locator('[data-testid="sidebar-shortcuts-trigger"]').click();
    await expect(
      page.locator('[data-testid="keyboard-shortcuts-dialog"]'),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.locator('[data-testid="keyboard-shortcuts-dialog"]'),
    ).toBeHidden();

    await page.getByLabel("Account menu").click();
    await expect(
      page.locator('[data-testid="account-release-notes"]'),
    ).toHaveAttribute(
      "href",
      "https://github.com/dnotitia/reef/releases/tag/v0.6.1",
    );
    await page.keyboard.press("Escape");

    await expect(page.locator('[data-testid="ask-ai-fab"]')).toBeVisible();
    await page.locator('[data-testid="ask-ai-fab"]').click();
    await expect(page.locator('[data-testid="ask-ai-dialog"]')).toBeVisible();
    await expect(page.locator('[data-testid="ask-ai-input"]')).toBeVisible();
    const chatResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        response.request().method() === "POST" &&
        url.pathname === "/api/agents/runs"
      );
    });
    await page
      .locator('[data-testid="ask-ai-input"]')
      .fill("Summarize this workspace");
    await page.locator('[data-testid="ask-ai-send"]').click();
    await chatResponse;
    await expect(
      page.locator('[data-testid="user-message"]').filter({
        hasText: "Summarize this workspace",
      }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="assistant-message"]').filter({
        hasText: "Mock OpenRouter response.",
      }),
    ).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-testid="ask-ai-close"]').click();
    await expect(page.locator('[data-testid="ask-ai-dialog"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    );

    await page.locator('[data-testid="sidebar-workspace-trigger"]').click();
    await page.locator('[data-testid="workspace-switcher-new"]').click();
    await expect(
      page.locator('[data-testid="create-workspace-dialog"]'),
    ).toBeVisible();
    await page.locator('[data-testid="create-workspace-cancel-btn"]').click();
    await expect(
      page.locator('[data-testid="create-workspace-dialog"]'),
    ).toBeHidden();
  });

  test("signs out from the account menu through the real logout route", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.getByLabel("Account menu").click();
    await page.locator('[data-testid="account-signout"]').click();
    await page.waitForURL(/\/login$/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="akb-login-form"]')).toBeVisible();
  });
});
