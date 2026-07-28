import { expect, test } from "@playwright/test";
import {
  resetFixture,
  setVaultListControl,
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

  test("automatically resumes a configured workspace without showing the creation form", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured");
    await page.addInitScript(() => {
      const state = window as Window & { __greenfieldFormSeen?: boolean };
      state.__greenfieldFormSeen = false;
      window.addEventListener("DOMContentLoaded", () => {
        const observer = new MutationObserver(() => {
          if (
            document.querySelector(
              '[data-testid="greenfield-vault-name-input"]',
            )
          ) {
            state.__greenfieldFormSeen = true;
          }
        });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      });
    });

    await signInAsAlice(page);
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/?$/, {
      timeout: 15_000,
    });
    await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __greenfieldFormSeen?: boolean })
            .__greenfieldFormSeen,
      ),
    ).toBe(false);
  });

  test("keeps an accessible loading state until a delayed vault list resolves", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured");
    await setVaultListControl(request, { delayMs: 800 });

    await signInAsAlice(page);
    await expect(page.getByTestId("workspace-resume-loading")).toBeVisible();
    await expect(
      page.locator('[data-testid="greenfield-vault-name-input"]'),
    ).toHaveCount(0);
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/?$/, {
      timeout: 15_000,
    });
  });

  test("retries a failed vault list without exposing onboarding", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured");
    await setVaultListControl(request, { failures: 1 });

    await signInAsAlice(page);
    await expect(page.getByTestId("workspace-resume-error")).toBeVisible();
    await expect(
      page.locator('[data-testid="greenfield-vault-name-input"]'),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/?$/, {
      timeout: 15_000,
    });
  });

  test("finishes SSO completion when an akb session cookie already exists", async ({
    page,
  }) => {
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    await page.goto("/login/sso-complete?next=/workspace/reef-e2e/reports");

    await page.waitForURL(/\/workspace\/reef-e2e\/reports$/, {
      timeout: 10_000,
    });
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
