import { test } from "../harness/workspace-fixture";
import { expect } from "@playwright/test";
import {
  clearPersistedQueryCacheOnLoad,
  readFixtureState,
} from "../harness/fixture";

// Settings offers recoverable Reef uninstall and owner-only full vault delete.
test.describe("Hermetic workspace lifecycle danger zone", () => {
  test.use({ scenario: "configured" });

  test("rejects fresh after Remove and restores the retained workspace", async ({
    openWorkspace,
    page,
    request,
  }) => {
    await clearPersistedQueryCacheOnLoad(page);
    await openWorkspace();

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
    expect(reefBefore?.tables).toContain("reef_settings");
    expect(reefBefore?.tables).toContain("reef_issues");
    expect(reefBefore?.issue_ids).toContain("REEF-001");
    expect(
      reefBefore?.documents.some((document) =>
        document.path.startsWith("issues/"),
      ),
    ).toBe(true);

    await page.goto("/workspace/reef-e2e/settings/workspace");
    const main = page.getByRole("main");
    await expect(main.getByTestId("danger-zone-section")).toBeVisible();
    await main.getByTestId("danger-zone-uninstall").click();
    const dialog = page.getByTestId("workspace-destructive-dialog");
    await expect(dialog).toHaveAttribute("data-mode", "uninstall");
    await expect(
      dialog.getByTestId("workspace-delete-confirm-input"),
    ).toHaveCount(0);
    await expect(
      dialog.getByTestId("workspace-destructive-confirm"),
    ).toBeEnabled();
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
    openWorkspace,
    page,
    request,
  }) => {
    await clearPersistedQueryCacheOnLoad(page);
    await openWorkspace();

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
