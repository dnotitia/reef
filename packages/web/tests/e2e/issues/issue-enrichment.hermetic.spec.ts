import { test } from "../harness/workspace-fixture";
import { expect } from "@playwright/test";
import { REEF_E2E_VAULT, continueToWorkspace } from "../harness/fixture";

test.describe("Hermetic New Issue enrichment", () => {
  test.use({ scenario: "configured" });

  test("streams field suggestions through the unified agent-run endpoint", async ({
    openWorkspace,
    page,
  }) => {
    await openWorkspace();
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);
    await continueToWorkspace(page);
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
