import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  setIssueListFailure,
  setPlanningCatalogFailure,
} from "../harness/fixture";

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
    await page.goto("/workspace/reef-e2e/planning");

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
    await page.goto("/workspace/reef-e2e/planning");
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

  test("separates catalog failure from the true empty state and converges after retry", async ({
    page,
    request,
  }) => {
    await clearPersistedQueryCacheOnLoad(page);
    await setPlanningCatalogFailure(request, true);
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/planning`);

    const error = page.getByTestId("planning-catalog-error");
    await expect(error).toBeVisible({ timeout: 20_000 });
    await expect(error).toHaveAttribute("role", "alert");
    await expect(error.getByText("Couldn't load planning.")).toBeVisible();
    await expect(page.getByTestId("planning-empty-sprints")).toHaveCount(0);

    await setPlanningCatalogFailure(request, false);
    await error.getByRole("button", { name: "Retry" }).click();

    await expect(page.getByText("Sprint Alpha")).toBeVisible();
    await expect(error).toHaveCount(0);
  });

  test("keeps linked-issue aggregation and delete fail-closed until issue retry succeeds", async ({
    page,
    request,
  }) => {
    await clearPersistedQueryCacheOnLoad(page);
    await setIssueListFailure(request, true);
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/planning`);

    const row = page.getByText("Sprint Alpha").locator("xpath=ancestor::tr");
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("planning-issue-error")).toBeVisible();
    await expect(row.getByText("Unable to verify")).toBeVisible();

    const deleteButton = row.getByRole("button", {
      name: "Delete Sprint Alpha",
    });
    await expect(deleteButton).toHaveAttribute("aria-disabled", "true");
    await expect(deleteButton).toHaveAttribute(
      "title",
      "Can't delete while linked issues can't be verified",
    );
    await expect(deleteButton).toHaveAttribute("aria-describedby", /.+/u);
    await deleteButton.focus();
    await expect(deleteButton).toBeFocused();

    await setIssueListFailure(request, false);
    await page
      .getByTestId("planning-issue-error")
      .getByRole("button", { name: "Retry" })
      .click();

    // The configured fixture has one real issue linked to Sprint Alpha. Once
    // the issue read succeeds, the accurate count keeps deletion disabled for
    // the ordinary linked-item guard rather than the unknown-integrity guard.
    await expect(row.getByText("1")).toBeVisible();
    await expect(deleteButton).toBeDisabled();
    await expect(deleteButton).not.toHaveAttribute("aria-disabled", "true");
    await expect(deleteButton).toHaveAttribute(
      "title",
      "Remove linked issues before deleting",
    );
  });

  test("keeps the existing empty planning state and create entry point for a successful empty catalog", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured_empty");
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/planning`);

    await expect(page.getByTestId("planning-empty-sprints")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole("heading", { name: "No sprints yet." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New sprint" }),
    ).toBeVisible();
    await expect(page.getByTestId("planning-catalog-error")).toHaveCount(0);
  });
});
