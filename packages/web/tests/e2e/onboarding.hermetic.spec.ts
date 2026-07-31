import { expect, test } from "@playwright/test";
import {
  readFixtureState,
  resetFixture,
  signInAsAlice,
  waitForPasswordLogin,
  writeIndexedDbConfig,
} from "./harness/fixture";

test.describe("Hermetic onboarding flow", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "empty");
  });

  test("creates a reef workspace through real Route Handlers", async ({
    page,
    request,
  }) => {
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    await page
      .locator('[data-testid="greenfield-vault-name-input"]')
      .fill("reef-new");
    await expect(
      page.locator('[data-testid="greenfield-project-prefix-input"]'),
    ).toHaveValue("REEF");
    await page.locator('[data-testid="greenfield-create-btn"]').click();

    await page.waitForURL(/\/issues\/?$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
    await expect(page.getByTestId("sidebar-workspace-trigger")).toContainText(
      "reef-new",
    );

    const state = await readFixtureState(request);
    const created = state.vaults.find((vault) => vault.name === "reef-new");
    expect(created?.settings.project_prefix).toBe("REEF");
    expect(created?.tables).toContain("reef_issues");
    expect(
      state.calls.some(
        (call) =>
          call.method === "POST" &&
          call.path === "/akb/api/v1/tables/reef-new/sql",
      ),
    ).toBe(true);
  });

  test("shows the existing-workspace empty state when no vault has reef config", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "raw_only");
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    await expect(
      page.locator('[data-testid="greenfield-vault-name-input"]'),
    ).toBeVisible();
  });

  test("prefers a remembered configured workspace", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured_multi");
    await page.goto("/login");
    await waitForPasswordLogin(page);
    await writeIndexedDbConfig(page, "akb_user_id", "user-alice");
    await writeIndexedDbConfig(page, "vault", "reef-zeta");

    await signInAsAlice(page);
    await expect(page).toHaveURL(/\/workspace\/reef-zeta\/issues\/?$/, {
      timeout: 15_000,
    });
  });

  test("rechecks a remembered workspace after cached selection and re-login", async ({
    context,
    page,
    request,
  }) => {
    await resetFixture(request, "configured_multi");
    await signInAsAlice(page);
    await expect(page).toHaveURL(/\/workspace\/reef-alpha\/issues\/?$/, {
      timeout: 15_000,
    });
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("REACT_QUERY_OFFLINE_CACHE")),
      )
      .toContain("reef-alpha");

    await context.clearCookies();
    await writeIndexedDbConfig(page, "akb_user_id", "user-alice");
    await writeIndexedDbConfig(page, "vault", "reef-zeta");
    await page.goto("/login");
    await waitForPasswordLogin(page);

    await signInAsAlice(page);
    await expect(page).toHaveURL(/\/workspace\/reef-zeta\/issues\/?$/, {
      timeout: 15_000,
    });
  });

  test("uses ASCII order for an invalid remembered workspace", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured_multi");
    await page.goto("/login");
    await waitForPasswordLogin(page);
    await writeIndexedDbConfig(page, "akb_user_id", "user-alice");
    await writeIndexedDbConfig(page, "vault", "missing");

    await signInAsAlice(page);
    await expect(page).toHaveURL(/\/workspace\/reef-alpha\/issues\/?$/, {
      timeout: 15_000,
    });
  });

  test("auto-resumes direct onboarding and Back does not return to it", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured");
    await signInAsAlice(page);
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/?$/, {
      timeout: 15_000,
    });

    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/?$/, {
      timeout: 15_000,
    });
    await page.goBack();
    await expect(page).not.toHaveURL(/\/onboarding\/?$/);
  });
});
