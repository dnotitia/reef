import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  resetFixture,
} from "../harness/fixture";

test.describe("Hermetic New Issue enrichment", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("streams field suggestions through the unified agent-run endpoint", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);
    await page.getByTestId("new-issue-trigger").click();
    await page
      .getByTestId("new-issue-title-input")
      .fill("OAuth login fails after token expiry");

    const runRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/agents/runs",
    );
    await page.getByTestId("enrich-trigger").click();

    const body = (await runRequest).postDataJSON();
    expect(body.task_id).toBe("issue.enrichment");
    expect(body.input.draft.fields.title).toBe(
      "OAuth login fails after token expiry",
    );

    const suggestion = page.locator(
      '[data-testid="field-suggestion"][data-field="priority"]',
    );
    await expect(suggestion).toContainText("91%", {
      timeout: 15_000,
    });
    await page.getByTestId("field-suggestion-accept-priority").click();
    await expect(suggestion).toHaveCount(0);
    await expect(page.getByTestId("new-issue-priority-select")).toContainText(
      "High",
    );
  });
});
