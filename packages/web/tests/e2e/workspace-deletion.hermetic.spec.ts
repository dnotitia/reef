import { expect, test } from "@playwright/test";
import {
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "./harness/fixture";

// REEF-322: the Settings › Workspace danger zone removes a workspace two ways —
// detach (drop only the reef layer, keep the akb vault) and full delete (drop
// the whole vault). Both run through the real reef-web Route Handlers and akb
// fixture, then redirect the app away from the now-unusable workspace.
test.describe("Hermetic workspace deletion danger zone (REEF-322)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("detach removes the reef layer, keeps the vault, and redirects to onboarding", async ({
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
    expect(reefBefore?.documents.some((d) => d.path.startsWith("issues/"))).toBe(
      true,
    );

    // Detach is a one-step confirm (no typing gate).
    await main.getByTestId("danger-zone-detach").click();
    const dialog = page.getByTestId("workspace-destructive-dialog");
    await expect(dialog).toHaveAttribute("data-mode", "detach");
    await dialog.getByTestId("workspace-destructive-confirm").click();

    // The workspace is no longer a reef workspace → app falls back to onboarding.
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    // The vault survives, but its reef tables and issue documents are gone.
    const after = await readFixtureState(request);
    const reefAfter = after.vaults.find((v) => v.name === "reef-e2e");
    expect(reefAfter).toBeDefined();
    expect(reefAfter?.tables).not.toContain("reef_settings");
    expect(reefAfter?.tables).not.toContain("reef_issues");
    expect(
      reefAfter?.documents.some((d) => d.path.startsWith("issues/")),
    ).toBe(false);
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
