import { expect, test } from "@playwright/test";
import { resetFixture, setKeycloakEnabled } from "../harness/fixture";

/**
 * The default hermetic runtime intentionally exercises local mode. Its auth
 * boundary must not revive the retired AKB-delegated browser SSO flow when an
 * older fixture catalog advertises Keycloak.
 */
test.describe("auth mode cutover", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "empty");
    await setKeycloakEnabled(request, true);
  });

  test("local mode keeps the password surface instead of following legacy SSO", async ({
    page,
  }) => {
    await page.goto("/login");

    await expect(page.locator('[data-testid="akb-login-form"]')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("link", { name: /workspace sso/i }),
    ).toHaveCount(0);
  });

  test("the Reef OIDC start route rejects the wrong mode", async ({
    request,
  }) => {
    const response = await request.get("/api/auth/akb/sso/start", {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe("/login?sso_error=wrong_mode");
  });

  test("the delegated AKB login proxy remains retired", async ({ request }) => {
    const response = await request.get("/api/auth/akb/sso/login");

    expect(response.status()).toBe(410);
    expect(await response.json()).toEqual({ error: "SSO route retired." });
  });
});
