import { expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "../harness/fixture";

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

  test("answers exact issue questions with completed traces across close/reopen", async ({
    page,
  }) => {
    const agentRunStatuses: number[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === "/api/agents/runs") {
        agentRunStatuses.push(response.status());
      }
    });

    await openExistingWorkspace(page);
    await page.locator('[data-testid="ask-ai-fab"]').click();
    const askInput = page.locator('[data-testid="ask-ai-input"]');
    const askSend = page.locator('[data-testid="ask-ai-send"]');
    await expect(askSend).toBeDisabled();
    await askInput.fill("   ");
    await expect(askSend).toBeDisabled();

    const firstAssistant = page
      .locator('[data-testid="assistant-message"]')
      .last();
    await askInput.fill("REEF-001 이슈의 제목과 상태를 알려줘");
    await expect(askSend).toBeEnabled();
    await askSend.click();
    await expect(firstAssistant).toContainText("Initial issue Alpha", {
      timeout: 15_000,
    });
    await expect(firstAssistant).toContainText("todo");
    await expect(firstAssistant).not.toContainText("Mock OpenRouter response.");
    const firstTrace = firstAssistant.locator(
      '[data-testid="chat-tool-trace"]',
    );
    await expect(firstTrace).toContainText("1 step");
    await firstTrace.locator('button[aria-expanded="false"]').click();
    await expect(firstTrace).toContainText("Read issue");
    await firstTrace.locator('button[aria-expanded="false"]').click();
    await expect(firstTrace).toContainText("read_issue");
    await expect(firstTrace).toContainText("REEF-001");
    await expect(
      firstAssistant.locator('a[href="/workspace/reef-e2e/issues/REEF-001"]'),
    ).toHaveText("REEF-001");

    await firstAssistant
      .locator('a[href="/workspace/reef-e2e/issues/REEF-001"]')
      .click();
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/REEF-001$/);
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await page.locator('[data-testid="issue-close"]').click();
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues$/);
    await page.locator('[data-testid="ask-ai-close"]').click();
    await expect(page.locator('[data-testid="ask-ai-dialog"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await page.locator('a[href="/workspace/reef-e2e/issues"]').click();
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues$/);
    await expect(page.locator('[data-testid="kanban-board"]')).toBeVisible();
    await expect(page.locator('[data-testid="ask-ai-fab"]')).toBeVisible();
    await page.locator('[data-testid="ask-ai-fab"]').click();
    await expect(page.locator('[data-testid="ask-ai-dialog"]')).toHaveAttribute(
      "aria-hidden",
      "false",
    );
    await expect(page.locator('[data-testid="ask-ai-send"]')).toBeDisabled();

    await page
      .locator('[data-testid="ask-ai-input"]')
      .fill("REEF-002 이슈의 제목과 상태를 알려줘");
    await page.locator('[data-testid="ask-ai-send"]').click();

    const secondAssistant = page
      .locator('[data-testid="assistant-message"]')
      .last();
    await expect(secondAssistant).toContainText("Initial issue Beta", {
      timeout: 15_000,
    });
    await expect(secondAssistant).toContainText("in_progress");
    await expect(secondAssistant).not.toContainText(
      "Mock OpenRouter response.",
    );
    const secondTrace = secondAssistant.locator(
      '[data-testid="chat-tool-trace"]',
    );
    await expect(secondTrace).toContainText("1 step");
    await secondTrace.locator('button[aria-expanded="false"]').click();
    await expect(secondTrace).toContainText("Read issue");
    await secondTrace.locator('button[aria-expanded="false"]').click();
    await expect(secondTrace).toContainText("read_issue");
    await expect(secondTrace).toContainText("REEF-002");
    await expect(
      secondAssistant.locator('a[href="/workspace/reef-e2e/issues/REEF-002"]'),
    ).toHaveText("REEF-002");
    expect(agentRunStatuses).toEqual([200, 200]);
    await expect(
      page.getByText("워크스페이스 세션이 없거나 올바르지 않습니다."),
    ).toHaveCount(0);
  });
});
