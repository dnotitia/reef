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

  test("expands a planning row by clicking its name, with one keyboard-operable toggle (REEF-264)", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/planning");
    await expect(page.getByText("Sprint Alpha")).toBeVisible();

    // The expanded detail panel is absent while collapsed.
    const panel = page.locator('[id^="planning-detail-"]');
    await expect(panel).toHaveCount(0);

    // AC1/AC2: the row name itself is the single disclosure toggle — clicking the
    // name (not just the 20px chevron) opens the detail body, and the one button
    // flips to its collapse state with aria-expanded=true.
    await page.getByText("Sprint Alpha").click();
    await expect(panel).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Collapse Sprint Alpha details" }),
    ).toHaveAttribute("aria-expanded", "true");

    // Clicking the name again collapses it.
    await page.getByText("Sprint Alpha").click();
    await expect(panel).toHaveCount(0);

    // AC5: the merged toggle is keyboard-operable via Enter and Space.
    await page
      .getByRole("button", { name: "Expand Sprint Alpha details" })
      .focus();
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    await page.keyboard.press(" ");
    await expect(panel).toHaveCount(0);
  });
});
