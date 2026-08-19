import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readIndexedDbConfig,
  resetFixture,
  signInAsAlice,
  waitForPasswordLogin,
  writeIndexedDbConfig,
} from "../harness/fixture";

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

  test("keeps the first authenticated sidebar navigation interactive after reload", async ({
    page,
  }) => {
    await signInAsAlice(page);
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/?$/, {
      timeout: 15_000,
    });
    await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();

    // The source-blind contract reaches this state after its authenticated
    // Issues refresh. Keep the first visible sidebar click in the same session
    // so a hydration or route-transition race cannot be hidden by a fresh tab.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
    await page.waitForTimeout(1_000);

    const planningLink = page.getByRole("link", { name: "Planning" });
    await expect(planningLink).toHaveAttribute(
      "href",
      "/workspace/reef-e2e/planning",
    );
    await planningLink.click();
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/planning\/?$/, {
      timeout: 10_000,
    });
    await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();
  });

  test("AC2: a shared deep link opens in the URL's workspace, not the Dexie default", async ({
    page,
  }) => {
    await signInAsAlice(page);
    await page.waitForURL(/\/workspace\/reef-e2e\/issues\/?$/, {
      timeout: 15_000,
    });
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

  test("AC4: vault-less dashboard links are no longer compatibility routes", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    const response = await page.goto("/issues/REEF-001?view=list");

    expect(response?.status()).toBe(404);
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
    await expect(
      page.getByRole("button", { name: "Account menu" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
  });

  test("a bare vault URL remains explicit through login", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured_multi");
    await page.goto("/workspace/raw-vault/issues");
    await expect(page).toHaveURL(
      /\/login\?redirect=%2Fworkspace%2Fraw-vault%2Fissues$/,
    );
    await waitForPasswordLogin(page);

    await page.locator('[data-testid="login-username"]').fill("alice");
    await page.locator('[data-testid="login-password"]').fill("password");
    await page.locator('[data-testid="login-submit"]').click();

    await expect(page).toHaveURL(/\/workspace\/raw-vault\/issues\/?$/, {
      timeout: 15_000,
    });
    await expect(
      page.locator('[data-testid="workspace-access-denied"]'),
    ).toBeVisible();
  });
});

test.describe("workspace root redirects (REEF-424)", () => {
  test.beforeEach(async ({ request }) => {
    await resetFixture(request, "configured");
  });

  test("B1: /workspace opens the remembered Reef workspace", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/workspace");

    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/?$/);
    await expect(page.getByText("Initial issue Alpha")).toBeVisible();
  });

  test("B2: /workspace sends a signed-in user without a default to onboarding", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "empty");
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    await page.goto("/workspace");

    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test("B3-B4: an explicit vault root opens Issues and preserves every query value", async ({
    page,
  }) => {
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    await page.goto("/workspace/reef-e2e?view=list&label=a&label=b&empty=");

    await expect(page).toHaveURL(
      /\/workspace\/reef-e2e\/issues\?view=list&label=a&label=b&empty=$/,
    );
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible();
    const destination = new URL(page.url());
    expect(destination.searchParams.get("view")).toBe("list");
    expect(destination.searchParams.getAll("label")).toEqual(["a", "b"]);
    expect(destination.searchParams.has("empty")).toBe(true);
    expect(destination.searchParams.get("empty")).toBe("");
  });

  test("B5: malformed and denied vault roots never replace the remembered default", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await expect
      .poll(() => readIndexedDbConfig(page, "vault"))
      .toBe(REEF_E2E_VAULT);

    const malformedResponse = await page.goto("/workspace/Bad_Vault");
    expect(malformedResponse?.status()).toBe(404);
    await expect
      .poll(() => readIndexedDbConfig(page, "vault"))
      .toBe(REEF_E2E_VAULT);

    for (const deniedVault of ["reef-other", "raw-vault"]) {
      await page.goto(`/workspace/${deniedVault}`);
      await expect(
        page.locator('[data-testid="workspace-access-denied"]'),
      ).toBeVisible();
      await expect(page).toHaveURL(
        new RegExp(`/workspace/${deniedVault}(?:/issues)?/?$`),
      );
      await expect
        .poll(() => readIndexedDbConfig(page, "vault"))
        .toBe(REEF_E2E_VAULT);
    }
  });

  test("B6: both workspace roots send an unauthenticated browser to login", async ({
    page,
  }) => {
    await page.goto("/workspace");
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/workspace/reef-e2e");
    await expect(page).toHaveURL(/\/login\?redirect=%2Fworkspace%2Freef-e2e$/);
  });
});
