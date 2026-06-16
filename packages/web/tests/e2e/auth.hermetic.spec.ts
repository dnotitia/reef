import { expect, test } from "@playwright/test";
import {
  resetFixture,
  signInAsAlice,
  waitForPasswordLogin,
} from "./harness/fixture";

test.describe("Hermetic auth flow", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "empty");
  });

  test("redirects an unauthenticated root visit to /login", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForURL(/\/login$/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="akb-login-form"]')).toBeVisible();
  });

  test("rejects invalid akb credentials without setting a session", async ({
    page,
    context,
  }) => {
    await page.goto("/login");
    await waitForPasswordLogin(page);
    await page.locator('[data-testid="login-username"]').fill("alice");
    await page.locator('[data-testid="login-password"]').fill("wrong-password");
    await page.locator('[data-testid="login-submit"]').click();

    await expect(page.getByText("Invalid username or password.")).toBeVisible();
    await expect(page.locator('[data-testid="akb-login-form"]')).toContainText(
      "Invalid username or password.",
    );
    const cookies = await context.cookies();
    expect(cookies.some((cookie) => cookie.name === "__reef_session")).toBe(
      false,
    );
  });

  test("signs in through the real login route and reaches onboarding", async ({
    page,
    context,
  }) => {
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="onboarding-panel"]'),
    ).toBeVisible();

    const cookies = await context.cookies();
    expect(cookies.some((cookie) => cookie.name === "__reef_session")).toBe(
      true,
    );
  });

  test("finishes SSO completion when an akb session cookie already exists", async ({
    page,
  }) => {
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    await page.goto("/login/sso-complete?next=/reports");

    await page.waitForURL(/\/reports$/, { timeout: 10_000 });
  });

  test("returns SSO completion failures to login with an error flag", async ({
    page,
  }) => {
    await page.goto("/login/sso-complete?next=/issues");

    await page.waitForURL(/\/login\?sso_error=completion_failed$/, {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="akb-login-form"]')).toBeVisible();
  });
});
