import { expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

// REEF-329: jira and confluence are first-class external_refs kinds. This drives
// the real "Reference kind" dropdown in the issue editor (a Radix Select that
// jsdom can't open), confirms both new brand kinds are offered, and — because
// the editor auto-saves each ref through the real reef-web update route — that a
// jira reference survives a reload (the persistence half of AC2).
const JIRA_URL = "https://acme.atlassian.net/browse/PROJ-42";

test.describe("Hermetic external reference kinds (REEF-329)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("offers Jira + Confluence in the reference-kind dropdown and persists a Jira link across reload", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();

    // Open the External references "Reference kind" select and confirm the two
    // new brand kinds are listed alongside the existing ones.
    const kindTrigger = page.getByRole("combobox", { name: "Reference kind" });
    await kindTrigger.click();
    await expect(page.getByRole("option", { name: "Jira" })).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Confluence" }),
    ).toBeVisible();

    // Pick Jira and enter a reference.
    await page.getByRole("option", { name: "Jira" }).click();
    await expect(kindTrigger).toContainText("Jira");
    await page.getByLabel("External reference", { exact: true }).fill(JIRA_URL);

    // Editing is inline auto-save: adding the ref fires a PATCH to the real
    // update route. Wait for that write to land before reloading so the reload
    // reads persisted state, not an in-flight optimistic update.
    const savePromise = page.waitForResponse(
      (res) =>
        res.request().method() === "PATCH" &&
        res.url().includes("/api/issues/REEF-001") &&
        res.ok(),
    );
    await page.getByRole("button", { name: "Add reference" }).click();
    await expect(page.getByRole("link", { name: JIRA_URL })).toBeVisible();
    await savePromise;

    // The jira-typed ref round-trips a reload (proving it was persisted to the
    // issue's meta.external_refs, not just held in local draft state).
    await page.reload();
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(page.getByRole("link", { name: JIRA_URL })).toBeVisible();
  });
});
