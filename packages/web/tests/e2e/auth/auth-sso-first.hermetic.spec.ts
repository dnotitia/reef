import { test as workspaceTest } from "../harness/workspace-fixture";
import { expect } from "@playwright/test";
import { E2E_MOCK_URL } from "../harness/fixture";

const test = workspaceTest.extend({ scenario: "empty" });

/** Real Reef companion flow with external OIDC/Redis wire fixtures. */
test.describe("SSO companion cutover", { tag: "@sso" }, () => {
  test("AC1: full chain bounces the browser to Keycloak with no reef panel", async ({
    page,
    request,
  }) => {
    await page.goto("/login?redirect=%2Fonboarding");

    await page.waitForURL(
      (url) => url.pathname === "/realms/reef/protocol/openid-connect/auth",
    );
    await expect(
      page.locator('[data-testid="fixture-keycloak-authorize"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="akb-login-form"]')).toHaveCount(0);
    await page.getByRole("link", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    const me = await page.request.get("/api/auth/akb/me");
    expect(me.status()).toBe(200);
    const cookies = await page.context().cookies();
    const session = cookies.find((cookie) => cookie.name === "__reef_auth_v2");
    expect(session).toMatchObject({
      httpOnly: true,
      sameSite: "Lax",
    });
    if (process.env.REEF_E2E_WEB_COMMAND?.includes(".next/standalone/"))
      expect(session?.secure).toBe(true);
    expect(session?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      cookies.some(
        (cookie) =>
          cookie.name === "__reef_session" ||
          cookie.name === "__reef_auth_v2_state",
      ),
    ).toBe(false);
    const observation = await request.get(`${E2E_MOCK_URL}/__e2e/sso`);
    expect(await observation.json()).toMatchObject({
      exchanges: 1,
      pkceVerified: true,
      bearerForwarded: true,
      sessionRecords: 1,
      loginRecords: 0,
      encryptedSessions: true,
    });
    const logout = await page.request.post("/api/auth/akb/logout", {
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(logout.status()).toBe(200);
    const revoked = await request.get(`${E2E_MOCK_URL}/__e2e/sso`);
    expect(await revoked.json()).toMatchObject({
      revocations: 1,
      sessionRecords: 0,
    });
    expect((await page.request.get("/api/auth/akb/me")).status()).toBe(401);
  });

  test("Keycloak remains available when the optional LLM capability is disabled", async ({
    page,
    request,
  }) => {
    const capabilityResponse = await request.get("/api/ai/managed-platform");
    expect(capabilityResponse.status()).toBe(200);
    expect(await capabilityResponse.json()).toEqual({
      ok: true,
      service: "reef-web",
      capability: "reef-llm-capability-v1",
      llm: { enabled: false, state: "disabled" },
    });

    await page.goto("/login");
    await page.waitForURL(
      (url) => url.pathname === "/realms/reef/protocol/openid-connect/auth",
    );
    await expect(
      page.locator('[data-testid="fixture-keycloak-authorize"]'),
    ).toBeVisible();
  });

  test("managed SSO-only policy keeps loop protection without opening password login", async ({
    page,
    request,
  }) => {
    expect(
      (
        await request.post(`${E2E_MOCK_URL}/__e2e/sso`, {
          data: { invalid_nonce: true },
        })
      ).ok(),
    ).toBe(true);
    await page.goto("/login");
    await page.getByRole("link", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/login\?sso_error=sso_callback_failed$/);
    expect((await page.request.get("/api/auth/akb/me")).status()).toBe(401);
    expect(
      (await (await request.get(`${E2E_MOCK_URL}/__e2e/sso`)).json())
        .sessionRecords,
    ).toBe(0);

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
