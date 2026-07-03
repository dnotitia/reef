import { expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

/**
 * REEF-360 — context-aware chat grounding.
 *
 * Drives the real /api/chat route handler (only the upstream OpenRouter provider
 * is mocked in the fixture). The mock reply is a fixed "Mock OpenRouter
 * response." string, so this spec proves the *grounding wiring* end-to-end
 * rather than answer quality (that is unit/eval-covered):
 *   - the issue-detail "Ask AI about this issue" affordance opens the panel with
 *     a context chip naming the issue (AC3);
 *   - the outgoing /api/chat request body carries `route` + `reefId` so core can
 *     ground on the current issue (AC2) — observed passively via waitForRequest,
 *     never a page.route mock (hermetic rule);
 *   - removing the chip drops the grounding, sending a context-free request (AC3).
 */
test.describe("Hermetic Ask AI context grounding (REEF-360)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("grounds the chat on the open issue and can be cleared to context-free", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();

    // AC3: the chrome overflow menu offers "Ask AI about this issue". It closes
    // the full-height issue sheet (which would otherwise occlude the floating
    // panel) and opens the chat grounded on the issue, shown by a context chip.
    await page.locator('[data-testid="issue-more-trigger"]').click();
    await page.locator('[data-testid="issue-ask-ai"]').click();
    await expect(page.locator('[data-testid="ask-ai-dialog"]')).toBeVisible();
    await expect(page.locator('[data-testid="issue-detail"]')).toBeHidden();
    await expect(
      page.locator('[data-testid="ask-ai-context-chip"]'),
    ).toContainText("REEF-001");

    // AC2: the grounded request carries the current route + the issue id.
    const groundedRequest = page.waitForRequest(
      (req) =>
        req.method() === "POST" && new URL(req.url()).pathname === "/api/chat",
    );
    await page
      .locator('[data-testid="ask-ai-input"]')
      .fill("What's the next step on this issue?");
    await page.locator('[data-testid="ask-ai-send"]').click();

    const groundedBody = (await groundedRequest).postDataJSON();
    expect(groundedBody.reefId).toBe("REEF-001");
    expect(typeof groundedBody.route).toBe("string");

    await expect(
      page.locator('[data-testid="assistant-message"]').filter({
        hasText: "Mock OpenRouter response.",
      }),
    ).toBeVisible({ timeout: 15_000 });

    // Visual proof for the PR: the panel grounded on REEF-001 with its chip.
    await page
      .locator('[data-testid="ask-ai-dialog"]')
      .screenshot({ path: "test-results/ask-ai-grounding-chip.png" });

    // AC3: removing the chip switches to context-free — the next request carries
    // no reefId.
    await page.locator('[data-testid="ask-ai-context-remove"]').click();
    await expect(
      page.locator('[data-testid="ask-ai-context-chip"]'),
    ).toHaveCount(0);

    const contextFreeRequest = page.waitForRequest(
      (req) =>
        req.method() === "POST" && new URL(req.url()).pathname === "/api/chat",
    );
    await page.locator('[data-testid="ask-ai-input"]').fill("And in general?");
    await page.locator('[data-testid="ask-ai-send"]').click();
    const contextFreeBody = (await contextFreeRequest).postDataJSON();
    expect(contextFreeBody.reefId ?? null).toBeNull();
  });
});
