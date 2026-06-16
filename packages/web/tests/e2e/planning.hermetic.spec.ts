import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "./harness/fixture";

function sprintNames(
  state: Awaited<ReturnType<typeof readFixtureState>>,
): string[] {
  return (
    state.vaults.find((vault) => vault.name === REEF_E2E_VAULT)?.sprints ?? []
  ).map((sprint) => sprint.name);
}

test.describe("Hermetic planning workflow", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("creates, updates, and deletes a sprint through /api/planning Route Handlers", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/planning");

    await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();
    await expect(page.getByText("Sprint Alpha")).toBeVisible();

    await page.getByRole("button", { name: "New sprint" }).click();
    await expect(
      page.locator('[data-testid="planning-editor-dialog"]'),
    ).toBeVisible();
    await page
      .locator('[data-testid="planning-name-input"]')
      .fill("E2E Sprint");
    await page.locator('[data-testid="planning-save"]').click();

    await expect(
      page.locator('[data-testid="planning-editor-dialog"]'),
    ).toBeHidden();
    await expect(page.getByText("E2E Sprint")).toBeVisible();
    await expect
      .poll(async () => sprintNames(await readFixtureState(request)))
      .toContain("E2E Sprint");

    await page.getByRole("button", { name: "Edit E2E Sprint" }).click();
    await page
      .locator('[data-testid="planning-name-input"]')
      .fill("E2E Sprint Edited");
    await page.locator('[data-testid="planning-save"]').click();

    await expect(page.getByText("E2E Sprint Edited")).toBeVisible();
    await expect
      .poll(async () => sprintNames(await readFixtureState(request)))
      .toContain("E2E Sprint Edited");

    await page
      .getByRole("button", { name: "Delete E2E Sprint Edited" })
      .click();
    await expect(
      page.locator('[data-testid="planning-delete-confirm"]'),
    ).toBeVisible();
    await page.locator('[data-testid="planning-delete-confirm-btn"]').click();

    await expect(
      page.locator('[data-testid="planning-delete-confirm"]'),
    ).toBeHidden();
    await expect
      .poll(async () => sprintNames(await readFixtureState(request)))
      .not.toContain("E2E Sprint Edited");
  });
});
