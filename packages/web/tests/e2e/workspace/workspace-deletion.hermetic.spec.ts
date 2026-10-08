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

  test("rejects fresh after Remove and restores the retained workspace", async ({
    page,
    request,
  }) => {
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);

    const installationResponse = await page.request.get(
      "/api/vaults/reef-e2e/installation",
    );
    expect(installationResponse.ok()).toBe(true);
    const installationBody = await installationResponse.json();
    const retainedReleaseId = installationBody.installation.currentRelease
      .id as string;
    expect(retainedReleaseId).toBeTruthy();

    const before = await readFixtureState(request);
    const reefBefore = before.vaults.find((vault) => vault.name === "reef-e2e");
    expect(reefBefore?.issue_ids).toContain("REEF-001");
    expect(
      reefBefore?.documents.some((document) =>
        document.path.startsWith("issues/"),
      ),
    ).toBe(true);

    await page.goto("/workspace/reef-e2e/settings/workspace");
    const main = page.getByRole("main");
    await main.getByTestId("danger-zone-uninstall").click();
    const dialog = page.getByTestId("workspace-destructive-dialog");
    await dialog.getByTestId("workspace-destructive-confirm").click();
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    await expect(page.getByTestId("onboarding-panel")).toBeVisible();
    await expect(
      page.getByTestId("workspace-installation-reef-e2e"),
    ).toHaveCount(0);
    for (const action of [
      "Set up Reef",
      "Restore installation",
      "Request fresh setup",
    ]) {
      await expect(page.getByRole("button", { name: action })).toHaveCount(0);
    }

    await page.goto("/workspace/reef-e2e/issues");
    await expect(page.getByTestId("workspace-access-denied")).toBeVisible();
    const accessGuidance = page.getByTestId("workspace-installation-reef-e2e");
    await expect(accessGuidance).toHaveAttribute(
      "data-status",
      "management_required",
    );
    await expect(
      page.getByTestId("installation-diagnostics-link-reef-e2e"),
    ).toBeVisible();
    for (const action of [
      "Set up Reef",
      "Restore installation",
      "Request fresh setup",
    ]) {
      await expect(
        accessGuidance.getByRole("button", { name: action }),
      ).toHaveCount(0);
    }

    await page.getByTestId("installation-diagnostics-link-reef-e2e").click();
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/settings\/workspace$/);
    const installationDetails = page.getByTestId(
      "workspace-installation-reef-e2e",
    );
    await expect(installationDetails).toHaveAttribute(
      "data-status",
      "uninstalled",
    );
    for (const action of [
      "Set up Reef",
      "Restore installation",
      "Request fresh setup",
    ]) {
      await expect(
        installationDetails.getByRole("button", { name: action }),
      ).toHaveCount(0);
    }

    const freshResponse = await page.request.post(
      "/api/vaults/reef-e2e/installation",
      { data: { mode: "fresh" } },
    );
    expect(freshResponse.status()).toBe(409);

    const afterFresh = await readFixtureState(request);
    const retainedAfterFresh = afterFresh.vaults.find(
      (vault) => vault.name === "reef-e2e",
    );
    expect(retainedAfterFresh?.installation?.lifecycle).toBe("uninstalled");
    expect(retainedAfterFresh?.tables).toEqual(reefBefore?.tables);
    expect(retainedAfterFresh?.settings).toEqual(reefBefore?.settings);
    expect(retainedAfterFresh?.issue_ids).toEqual(reefBefore?.issue_ids);
    expect(retainedAfterFresh?.issues).toEqual(reefBefore?.issues);
    expect(retainedAfterFresh?.documents).toEqual(reefBefore?.documents);

    const restoreResponse = await page.request.post(
      "/api/vaults/reef-e2e/installation",
      { data: { mode: "restore" } },
    );
    expect(restoreResponse.status()).toBe(202);
    const restoredBody = await restoreResponse.json();
    expect(restoredBody.installation.currentRelease.id).toBe(retainedReleaseId);

    const afterRestore = await readFixtureState(request);
    const restored = afterRestore.vaults.find(
      (vault) => vault.name === "reef-e2e",
    );
    expect(restored?.installation?.lifecycle).toBe("active");
    expect(restored?.tables).toEqual(reefBefore?.tables);
    expect(restored?.settings).toEqual(reefBefore?.settings);
    expect(restored?.issue_ids).toEqual(reefBefore?.issue_ids);
    expect(restored?.issues).toEqual(reefBefore?.issues);
    expect(restored?.documents).toEqual(reefBefore?.documents);
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
