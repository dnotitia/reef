import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readIndexedDbConfig,
  resetFixture,
  signInAsAlice,
  writeIndexedDbConfig,
} from "./harness/fixture";

/**
 * Workspace-as-URL-segment routing (REEF-315). The active workspace is now a
 * first-class path segment (`/workspace/{vault}/…`); the Dexie pointer is only a
 * per-browser default. These flows exercise the real Route Handlers and the new
 * route tree end to end.
 */
test.describe("workspace URL routing (REEF-315)", () => {
  test.beforeEach(async ({ request }) => {
    await resetFixture(request, "configured");
  });

  test("AC1: opens the board at a vault-scoped URL", async ({ page }) => {
    await openExistingWorkspace(page);
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/?$/);
    await expect(
      page.locator('[data-testid="sidebar-workspace"]'),
    ).toBeVisible();
  });

  test("AC2: a shared deep link opens in the URL's workspace, not the Dexie default", async ({
    page,
  }) => {
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });
    // Point this browser's "last viewed" default at a DIFFERENT workspace, to
    // prove the path segment — not the pointer — decides what opens.
    await writeIndexedDbConfig(page, "vault", "raw-vault");

    await page.goto("/workspace/reef-e2e/issues/REEF-001");

    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/REEF-001/);
    // The one-way URL→Dexie sync then records the viewed workspace as the new
    // default (AC6).
    await expect
      .poll(() => readIndexedDbConfig(page, "vault"), { timeout: 10_000 })
      .toBe(REEF_E2E_VAULT);
  });

  test("AC4: a legacy flat link redirects to its vault-scoped path, preserving the query", async ({
    page,
  }) => {
    // openExistingWorkspace leaves reef-e2e as the remembered default.
    await openExistingWorkspace(page);

    await page.goto("/issues/REEF-001?view=list");

    await page.waitForURL(
      /\/workspace\/reef-e2e\/issues\/REEF-001\?view=list$/,
      { timeout: 10_000 },
    );
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
  });

  test("AC4: a legacy link with no remembered workspace goes to onboarding", async ({
    page,
  }) => {
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });
    // No workspace selected yet → no Dexie default.
    await page.goto("/issues");
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });
  });

  test("AC5: a malformed workspace segment returns 404", async ({ page }) => {
    await openExistingWorkspace(page);
    // Uppercase violates VAULT_NAME_RE, so the segment can never be a real vault.
    const response = await page.goto("/workspace/Bad_Vault/issues");
    expect(response?.status()).toBe(404);
    await expect(page.locator('[data-testid="sidebar-workspace"]')).toHaveCount(
      0,
    );
  });

  test("AC5: a non-member workspace shows an explicit access-denied surface", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    // Well-formed name the signed-in user is not a member of — no silent fallback.
    await page.goto("/workspace/reef-other/issues");

    await expect(
      page.locator('[data-testid="workspace-access-denied"]'),
    ).toBeVisible();
    // It offers the user's own workspaces as the way out.
    await expect(
      page.locator('[data-testid="access-denied-workspace-reef-e2e"]'),
    ).toBeVisible();
  });
});
