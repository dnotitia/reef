import { expect, test } from "@playwright/test";
import {
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "../harness/fixture";

// Settings offers recoverable Reef uninstall and owner-only full vault delete.
test.describe("Hermetic workspace lifecycle danger zone", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("uninstall keeps AKB data and redirects to onboarding", async ({
    page,
    request,
  }) => {
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/settings/workspace");
    const main = page.getByRole("main");
    // Owner-only danger zone renders for alice (owner of reef-e2e).
    await expect(main.getByTestId("danger-zone-section")).toBeVisible();

    // Sanity: reef-e2e starts with reef tables and issue documents.
    const before = await readFixtureState(request);
    const reefBefore = before.vaults.find((v) => v.name === "reef-e2e");
    expect(reefBefore?.tables).toContain("reef_settings");
    expect(
      reefBefore?.documents.some((d) => d.path.startsWith("issues/")),
    ).toBe(true);

    // Uninstall is recoverable, so confirmation does not require typing the name.
    await main.getByTestId("danger-zone-uninstall").click();
    const dialog = page.getByTestId("workspace-destructive-dialog");
    await expect(dialog).toHaveAttribute("data-mode", "uninstall");
    await dialog.getByTestId("workspace-destructive-confirm").click();

    // An uninstalled workspace is no longer available to Reef until restored.
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    // AKB retains the data so the app can restore it later.
    const after = await readFixtureState(request);
    const reefAfter = after.vaults.find((v) => v.name === "reef-e2e");
    expect(reefAfter).toBeDefined();
    expect(reefAfter?.tables).toContain("reef_settings");
    expect(reefAfter?.tables).toContain("reef_issues");
    expect(reefAfter?.documents.some((d) => d.path.startsWith("issues/"))).toBe(
      true,
    );
  });

  test("delete requires typing the name, removes the whole vault, and redirects", async ({
    page,
    request,
  }) => {
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/settings/workspace");
    const main = page.getByRole("main");
    await expect(main.getByTestId("danger-zone-section")).toBeVisible();

    await main.getByTestId("danger-zone-delete").click();
    const dialog = page.getByTestId("workspace-destructive-dialog");
    await expect(dialog).toHaveAttribute("data-mode", "delete");

    // The confirm button is gated on typing the exact workspace name.
    const confirm = dialog.getByTestId("workspace-destructive-confirm");
    await expect(confirm).toBeDisabled();
    await dialog.getByTestId("workspace-delete-confirm-input").fill("reef-e2e");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    // The vault is gone entirely.
    const after = await readFixtureState(request);
    expect(after.vaults.some((v) => v.name === "reef-e2e")).toBe(false);
  });
});
