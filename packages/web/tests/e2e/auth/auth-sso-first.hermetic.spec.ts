import { expect, test } from "@playwright/test";
import { resetFixture, setKeycloakEnabled } from "../harness/fixture";

/**
 * SSO-first login (REEF-312): with `REEF_SSO_AUTO_REDIRECT` on (set for the
 * hermetic web server), entering /login redirects straight to akb/Keycloak —
 * but only on a clean entry, only when akb reports Keycloak enabled, and with
 * the original destination preserved. The fixture keeps Keycloak disabled by
 * default; these tests opt in via the /__e2e/keycloak toggle.
 */
test.describe("SSO companion cutover", () => {
  test.skip(true, "SSO companion OIDC + Redis runtime is prepared separately");
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "empty");
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

  test("managed SSO-only policy keeps loop protection without opening password login", async ({
    page,
  }) => {
    // Requires the separately prepared exclusive SSO companion runtime.
    await page.goto("/login?sso_error=exchange_failed");

    await expect(page.getByTestId("login-error-alert")).toContainText(
      "SSO could not complete",
    );
    await expect(
      page.locator('a[href^="/api/auth/akb/sso/start?provider="]').first(),
    ).toBeVisible();
    await expect(page.locator('[data-testid="akb-login-form"]')).toHaveCount(0);

    await page.goto("/login?password=1");

    await expect(
      page.locator('a[href^="/api/auth/akb/sso/start?provider="]').first(),
    ).toBeVisible();
    await expect(page.locator('[data-testid="akb-login-form"]')).toHaveCount(0);
  });

  test("SSO provider selection uses neutral copy without narrow overflow", async ({
    page,
    request,
  }) => {
    // The local fixture cannot provide SSO; a prepared companion owns this gap.
    const capabilityResponse = await request.get("/api/auth/akb/config");
    expect(capabilityResponse.status()).toBe(200);
    expect(await capabilityResponse.json()).toMatchObject({
      auth_mode: "sso",
      local_auth: { enabled: false },
    });

    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/login?password=1");

      await expect(
        page.locator('a[href^="/api/auth/akb/sso/start?provider="]').first(),
      ).toBeVisible();
      await expect(
        page.getByText("Sign-in method", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Use the identity provider configured for this workspace.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByText("Or sign in with username and password", {
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(page.getByTestId("akb-login-form")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("akb-platform");

      const geometry = await page.evaluate(() => {
        const sso = document.querySelector<HTMLAnchorElement>(
          'a[href^="/api/auth/akb/sso/start"]',
        );
        if (!sso) throw new Error("SSO link is missing");
        const rect = sso.getBoundingClientRect();
        return {
          documentOverflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
          ssoContained: rect.left >= 0 && rect.right <= window.innerWidth,
        };
      });

      expect(geometry.documentOverflow, `viewport ${width}px`).toBe(false);
      expect(geometry.ssoContained, `viewport ${width}px`).toBe(true);
    }
  });
});
