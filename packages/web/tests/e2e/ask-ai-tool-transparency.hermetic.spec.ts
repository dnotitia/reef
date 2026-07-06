import { expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

/**
 * REEF-372 — Ask AI tool transparency through a hermetic fake LLM tool loop.
 *
 * Drives the real reef-web login, workspace, and /api/agents/runs route handler.
 * The fixture only mocks external AKB/OpenRouter boundaries: OpenRouter emits a
 * Responses API function-call turn for search_issues + search_documents, the
 * server executes the real core tools against the seeded AKB fixture, and the
 * second LLM turn returns final prose after tool outputs.
 */
test.describe("Hermetic Ask AI tool transparency (REEF-372)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("shows live/completed tool steps, citations, and issue deep links", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await expect(page.locator('[data-testid="ask-ai-fab"]')).toBeVisible();

    await page.locator('[data-testid="ask-ai-fab"]').click();
    await expect(page.locator('[data-testid="ask-ai-dialog"]')).toBeVisible();

    await page
      .locator('[data-testid="ask-ai-input"]')
      .fill(
        "tool transparency e2e: search for Initial issue Alpha and cite the Spec overview document.",
      );
    await page.locator('[data-testid="ask-ai-send"]').click();

    const assistant = page.locator('[data-testid="assistant-message"]').last();
    const trace = assistant.locator('[data-testid="chat-tool-trace"]');
    await expect(trace).toBeVisible();
    await expect(trace).toContainText("Searching issues");

    await expect(assistant).toContainText("REEF-001", { timeout: 15_000 });
    await expect(trace.locator('button[aria-expanded="false"]')).toBeVisible();
    await expect(trace).toContainText("2 steps");
    await expect(trace).not.toContainText("Searched issues");

    await trace.locator('button[aria-expanded="false"]').click();
    await expect(trace).toContainText("Searched issues");
    await expect(trace).toContainText("Searched documents");
    await expect(trace).toContainText("1 result");

    await expect(
      assistant.locator('[data-testid="chat-citations"]'),
    ).toContainText("Spec overview");

    await page
      .locator('[data-testid="ask-ai-dialog"]')
      .screenshot({ path: "test-results/ask-ai-tool-transparency.png" });

    const reefLink = assistant.locator(
      'a[href="/workspace/reef-e2e/issues/REEF-001"]',
    );
    await expect(reefLink).toHaveText("REEF-001");
    await reefLink.click();
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/REEF-001$/);
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
  });
});
