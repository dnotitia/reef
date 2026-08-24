import { expect, test } from "@playwright/test";
import {
  openExistingWorkspace,
  resetFixture,
  setAkbAccountDenial,
  setAuthControl,
} from "../harness/fixture";

const WORKSPACE = "/workspace/reef-e2e";
const ISSUES_PATH = `${WORKSPACE}/issues`;
const PLANNING_PATH = `${WORKSPACE}/planning`;

function isAuthProbeRequest(request: import("@playwright/test").Request) {
  return (
    new URL(request.url()).pathname === "/api/auth/akb/me" &&
    request.method() === "GET"
  );
}

async function expectLogin(
  page: import("@playwright/test").Page,
  redirect?: string,
): Promise<void> {
  await page.waitForURL((url) => url.pathname === "/login", {
    timeout: 12_000,
  });
  if (redirect) {
    expect(new URL(page.url()).searchParams.get("redirect")).toBe(redirect);
  }
}

async function expectPersistentShell(
  page: import("@playwright/test").Page,
): Promise<void> {
  await expect(
    page.getByRole("complementary", { name: "Sidebar" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await expect(page.locator('[data-testid="app-shell-skeleton"]')).toHaveCount(
    0,
  );
}

test.describe("REEF-552 auth soft navigation", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
    await setAuthControl(request, {});
  });

  test("keeps a cold protected destination behind auth and preserves a safe nested redirect", async ({
    page,
    request,
  }) => {
    await page.goto("/login");
    const firstVisitResponse = await request.get("/api/auth/akb/me");
    const firstVisit = {
      invalidated:
        firstVisitResponse.headers()["x-reef-auth-invalidated"] ?? null,
      status: firstVisitResponse.status(),
    };
    expect(firstVisit).toEqual({ invalidated: null, status: 401 });

    await page.goto(`${PLANNING_PATH}?kind=sprints`);
    await expectLogin(page, PLANNING_PATH);
    await expect(page.locator('[data-testid="planning-skeleton"]')).toHaveCount(
      0,
    );
    await expect(
      page.locator('[data-testid="planning-compact-list"]'),
    ).toHaveCount(0);
  });

  test("converges an externally revoked established session on soft navigation", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await expect(page).toHaveURL(new RegExp(`${ISSUES_PATH}$`));

    const issuesLink = page.locator(`a[href="${ISSUES_PATH}"]`);
    const planningLink = page.locator(`a[href="${PLANNING_PATH}"]`);
    await expect(issuesLink).toBeAttached();
    await expect(issuesLink).toBeVisible();
    await expect(planningLink).toBeAttached();
    await expect(planningLink).toBeVisible();

    // Prove the warm cookie is still valid before scheduling the external
    // revocation. This avoids treating a slow login-shell probe as the
    // soft-navigation probe under test.
    const activeSessionStatus = await page.evaluate(async () => {
      const response = await fetch("/api/auth/akb/me", {
        credentials: "same-origin",
        cache: "no-store",
      });
      return response.status;
    });
    expect(activeSessionStatus).toBe(200);

    const probe = page.waitForRequest(isAuthProbeRequest);
    const destination = page.waitForURL(
      (url) => url.pathname === PLANNING_PATH,
    );
    // Start the fixture revocation before the real locator click, but keep both
    // operations in flight so no background probe can win the navigation race.
    const revocation = setAuthControl(request, { session: "revoked" });
    const navigation = planningLink.click();
    await Promise.all([revocation, navigation, probe, destination]);
    await expectLogin(page, PLANNING_PATH);

    await expect(page.locator('[data-testid="planning-skeleton"]')).toHaveCount(
      0,
    );
    await expect(
      page.locator('[data-testid="planning-compact-list"]'),
    ).toHaveCount(0);
  });

  test("fails closed at the bounded probe timeout without exposing destination content", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setAuthControl(request, { probeHang: true });

    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expectLogin(page);
    await expect(page.locator('[data-testid="planning-skeleton"]')).toHaveCount(
      0,
    );
  });

  test("keeps a valid slow destination in the protected shell until the probe completes", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setAuthControl(request, { probeDelayMs: 1_200 });

    const probe = page.waitForRequest(isAuthProbeRequest);
    await Promise.all([
      page.waitForURL((url) => url.pathname === PLANNING_PATH),
      page.locator(`a[href="${PLANNING_PATH}"]`).click(),
    ]);
    await probe;

    await page.waitForTimeout(300);
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    await expect(
      page.locator('[data-testid="planning-compact-list"]'),
    ).toHaveCount(0);
    await expectPersistentShell(page);
    await expect(
      page.locator('[data-testid="auth-revalidation-status"]'),
    ).toBeVisible();

    await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("keeps the established shell during a visible-tab revalidation", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setAuthControl(request, { probeDelayMs: 1_200 });

    const probe = page.waitForRequest(isAuthProbeRequest);
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await probe;

    await page.waitForTimeout(300);
    await expect(page).toHaveURL(new RegExp(`${ISSUES_PATH}$`));
    await expectPersistentShell(page);
    await expect(
      page.locator('[data-testid="auth-revalidation-status"]'),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Issues" })).toHaveCount(0);

    await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("ignores a late probe result after a soft-navigation probe supersedes it", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setAuthControl(request, {
      probeDelayMs: 6_000,
      probeDelayOnce: true,
    });

    const delayedProbe = page.waitForRequest(isAuthProbeRequest);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document
        .querySelector<HTMLAnchorElement>(
          'a[href="/workspace/reef-e2e/planning"]',
        )
        ?.click();
    });
    await delayedProbe;

    await expect(page).toHaveURL(new RegExp(`${PLANNING_PATH}$`), {
      timeout: 10_000,
    });
    await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible({
      timeout: 15_000,
    });

    await page.waitForTimeout(6_200);
    await expect(page).toHaveURL(new RegExp(`${PLANNING_PATH}$`));
    await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();
  });

  test("keeps a resource 403 in place and preserves account-denial UX", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setAuthControl(request, { protectedResponse: "forbidden" });

    const resourceResponse = await page.evaluate(async () => {
      const response = await fetch("/api/users/search?vault=reef-e2e&q=alice", {
        credentials: "same-origin",
        cache: "no-store",
      });
      return {
        invalidated: response.headers.get("X-Reef-Auth-Invalidated"),
        status: response.status,
      };
    });
    expect(resourceResponse).toEqual({ invalidated: null, status: 403 });
    await expect(page).toHaveURL(new RegExp(`${ISSUES_PATH}$`));

    await setAkbAccountDenial(request, "membership_required");
    await page.reload();
    await expectLogin(page);
    expect(new URL(page.url()).searchParams.get("sso_error")).toBe(
      "membership_required",
    );
  });

  test("redirects this tab when a sibling tab broadcasts AUTH_CHANGED_EVENT", async ({
    context,
    page,
  }) => {
    await openExistingWorkspace(page);

    const sibling = await context.newPage();
    try {
      await sibling.goto(page.url());
      await expect(sibling.locator(`a[href="${ISSUES_PATH}"]`)).toBeVisible();

      await sibling.evaluate(() => {
        const channel = new BroadcastChannel("reef:auth");
        channel.postMessage("reef:auth-changed");
        channel.close();
      });

      await expectLogin(page, ISSUES_PATH);
    } finally {
      await sibling.close();
    }
  });
});
