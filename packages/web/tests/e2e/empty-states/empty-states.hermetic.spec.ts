import { expect, test } from "@playwright/test";
import {
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "../harness/fixture";

test.describe("Hermetic configured empty routed surfaces", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured_empty");
  });

  test("renders the configured empty workspace across its routed surfaces", async ({
    page,
    request,
  }) => {
    const state = await readFixtureState(request);
    const vault = state.vaults.find((item) => item.name === "reef-e2e");
    expect(vault).toMatchObject({
      issue_ids: [],
      sprints: [],
      milestones: [],
      releases: [],
      notifications: [],
    });

    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/my-work");
    await expect(page.getByTestId("my-work-empty")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Go to the board/ }),
    ).toHaveAttribute("href", "/workspace/reef-e2e/issues?view=board");

    await page.goto("/workspace/reef-e2e/inbox");
    const inboxEmpty = page.getByTestId("notification-inbox-empty");
    await expect(inboxEmpty).toBeVisible();
    await expect(inboxEmpty.getByRole("button")).toHaveCount(0);

    await page.goto("/workspace/reef-e2e/reports");
    const reportsEmpty = page.getByTestId("reports-empty");
    await expect(reportsEmpty).toBeVisible();
    await expect(reportsEmpty).toContainText("No active issues yet");
    await expect(reportsEmpty.getByRole("button")).toHaveCount(0);

    await page.goto("/workspace/reef-e2e/planning");
    await expect(page.getByTestId("planning-empty-sprints")).toBeVisible();

    await page.getByRole("button", { name: "Milestones" }).click();
    await page.waitForURL(/planning\?kind=milestones$/);
    await expect(page.getByTestId("planning-empty-milestones")).toBeVisible();

    await page.getByRole("button", { name: "Releases" }).click();
    await page.waitForURL(/planning\?kind=releases$/);
    await expect(page.getByTestId("planning-empty-releases")).toBeVisible();

    await page
      .getByTestId("planning-empty-releases")
      .getByRole("button", { name: "New release" })
      .click();
    await expect(
      page.locator('[data-testid="planning-editor-dialog"]'),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.locator('[data-testid="planning-editor-dialog"]'),
    ).toBeHidden();
  });
});
