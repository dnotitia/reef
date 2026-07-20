import { expect, test } from "@playwright/test";
import {
  resetFixture,
  setAuthPolicy,
  setKeycloakEnabled,
} from "./harness/fixture";

/**
 * SSO-first login (REEF-312): with `REEF_SSO_AUTO_REDIRECT` on (set for the
 * hermetic web server), entering /login redirects straight to akb/Keycloak —
 * but only on a clean entry, only when akb reports Keycloak enabled, and with
 * the original destination preserved. The fixture keeps Keycloak disabled by
 * default; these tests opt in via the /__e2e/keycloak toggle.
 */
test.describe("SSO-first login auto-redirect", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "empty");
  });

  test("AC1/AC4: clean entry redirects to SSO start, preserving the destination", async ({
    request,
  }) => {
    await setKeycloakEnabled(request, true);

    const res = await request.get(
      `/login?redirect=${encodeURIComponent("/issues?status=open")}`,
      { maxRedirects: 0 },
    );

    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    const location = res.headers().location;
    expect(location).toBeTruthy();
    const target = new URL(location, "http://localhost");
    expect(target.pathname).toBe("/api/auth/akb/sso/start");
    expect(target.searchParams.get("redirect")).toBe("/issues?status=open");
  });

  test("AC1: full chain bounces the browser to Keycloak with no reef panel", async ({
    page,
    request,
  }) => {
    await setKeycloakEnabled(request, true);

    await page.goto("/login");

    await page.waitForURL(/\/keycloak\/authorize$/, { timeout: 15_000 });
    await expect(
      page.locator('[data-testid="fixture-keycloak-authorize"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="akb-login-form"]')).toHaveCount(0);
  });

  test("Keycloak remains available when the optional LLM capability is disabled", async ({
    page,
    request,
  }) => {
    test.skip(
      process.env.REEF_E2E_LLM_DISABLED !== "1",
      "This deployment-contract scenario runs in the governance gate.",
    );
    await setKeycloakEnabled(request, true);

    const capabilityResponse = await request.get("/api/ai/managed-platform");
    expect(capabilityResponse.status()).toBe(200);
    expect(await capabilityResponse.json()).toEqual({
      ok: true,
      service: "reef-web",
      capability: "reef-llm-capability-v1",
      llm: { enabled: false, state: "disabled" },
    });

    await page.goto("/login");
    await page.waitForURL(/\/keycloak\/authorize$/, { timeout: 15_000 });
    await expect(
      page.locator('[data-testid="fixture-keycloak-authorize"]'),
    ).toBeVisible();
  });

  test("AC2: an SSO error keeps the panel (loop guard)", async ({
    page,
    request,
  }) => {
    await setKeycloakEnabled(request, true);

    const res = await page.goto("/login?sso_error=exchange_failed");

    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("login-error-alert")).toContainText(
      "SSO could not complete",
    );
    await expect(page.locator('[data-testid="akb-login-form"]')).toBeVisible();
  });

  test("AC2: a legacy session error keeps the panel (loop guard)", async ({
    page,
    request,
  }) => {
    await setKeycloakEnabled(request, true);

    const res = await page.goto("/login?error=expired");

    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("login-error-alert")).toContainText(
      "previous session has ended",
    );
    await expect(page.locator('[data-testid="akb-login-form"]')).toBeVisible();
  });

  test("AC3: the password escape hatch keeps the panel", async ({
    page,
    request,
  }) => {
    await setKeycloakEnabled(request, true);

    for (const query of ["password=1", "prompt=login"]) {
      const res = await page.goto(`/login?${query}`);
      expect(res?.status(), `query ${query}`).toBe(200);
      await expect(
        page.locator('[data-testid="akb-login-form"]'),
        `query ${query}`,
      ).toBeVisible();
    }
  });

  test("managed SSO-only policy keeps loop protection without opening password login", async ({
    page,
    request,
  }) => {
    await setAuthPolicy(request, {
      keycloakEnabled: true,
      localAuthEnabled: false,
      ssoOnly: true,
    });

    await page.goto("/login?sso_error=exchange_failed");

    await expect(page.getByTestId("login-error-alert")).toContainText(
      "SSO could not complete",
    );
    await expect(
      page.getByRole("link", { name: /continue with workspace sso/i }),
    ).toBeVisible();
    await expect(page.locator('[data-testid="akb-login-form"]')).toHaveCount(0);

    await page.goto("/login?password=1");

    await expect(
      page.getByRole("link", { name: /continue with workspace sso/i }),
    ).toBeVisible();
    await expect(page.locator('[data-testid="akb-login-form"]')).toHaveCount(0);
  });

  test("AC5: SSO disabled keeps today's panel even with the opt-in on", async ({
    page,
    request,
  }) => {
    await setKeycloakEnabled(request, false);

    await page.goto("/login");

    await expect(page.locator('[data-testid="akb-login-form"]')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
