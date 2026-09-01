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

test.describe("auth soft navigation", () => {
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

  test("does not probe during ordinary page and issue-detail navigation", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await expect(page).toHaveURL(new RegExp(`${ISSUES_PATH}$`));

    let authProbeCount = 0;
    const countAuthProbe = (request: import("@playwright/test").Request) => {
      if (isAuthProbeRequest(request)) authProbeCount += 1;
    };
    page.on("request", countAuthProbe);

    try {
      await setAuthControl(request, { probeDelayMs: 1_200 });
      await page.locator(`a[href="${PLANNING_PATH}"]`).click();
      await page.waitForURL((url) => url.pathname === PLANNING_PATH);
      await expect(
        page.getByRole("heading", { name: "Planning" }),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="auth-revalidation-status"]'),
      ).toHaveCount(0);
      expect(authProbeCount).toBe(0);

      await page.locator(`a[href="${ISSUES_PATH}"]`).click();
      await page.waitForURL((url) => url.pathname === ISSUES_PATH);
      await page.getByText("Initial issue Alpha", { exact: true }).click();
      await page.waitForURL(/\/issues\/REEF-001(?:\?|$)/);
      await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
      await expect(
        page.locator('[data-testid="auth-revalidation-status"]'),
      ).toHaveCount(0);
      expect(authProbeCount).toBe(0);

      await page.locator('[data-testid="issue-close"]').click();
      await page.waitForURL((url) => url.pathname === ISSUES_PATH);
      expect(authProbeCount).toBe(0);
    } finally {
      page.off("request", countAuthProbe);
    }
  });

  test("converges an externally revoked established session on focus revalidation", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setAuthControl(request, { session: "revoked" });

    const probe = page.waitForRequest(isAuthProbeRequest);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await probe;
    await expectLogin(page, ISSUES_PATH);
  });

  test("fails closed at the bounded probe timeout without exposing destination content", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setAuthControl(request, { probeHang: true });

    const probe = page.waitForRequest(isAuthProbeRequest);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await probe;
    await expectLogin(page, ISSUES_PATH);
    await expect(page.locator('[data-testid="planning-skeleton"]')).toHaveCount(
      0,
    );
  });

  test("keeps a valid slow destination in the protected shell until page data completes", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setAuthControl(request, { probeDelayMs: 1_200 });

    let authProbeCount = 0;
    const countAuthProbe = (request: import("@playwright/test").Request) => {
      if (isAuthProbeRequest(request)) authProbeCount += 1;
    };
    page.on("request", countAuthProbe);

    try {
      await Promise.all([
        page.waitForURL((url) => url.pathname === PLANNING_PATH),
        page.locator(`a[href="${PLANNING_PATH}"]`).click(),
      ]);
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
      await expectPersistentShell(page);
      await expect(
        page.locator('[data-testid="auth-revalidation-status"]'),
      ).toHaveCount(0);
      expect(authProbeCount).toBe(0);
      await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible(
        {
          timeout: 15_000,
        },
      );
    } finally {
      page.off("request", countAuthProbe);
    }
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
    ).toHaveCount(0);

    await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("ignores a late probe result after an immediate invalidation", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setAuthControl(request, {
      probeDelayMs: 6_000,
      probeDelayOnce: true,
    });

    const delayedProbe = page.waitForRequest(isAuthProbeRequest);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await delayedProbe;

    await page.evaluate(() =>
      window.dispatchEvent(new Event("reef:auth-changed")),
    );
    await expectLogin(page, ISSUES_PATH);

    await page.waitForTimeout(6_200);
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
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
      await expect(
        sibling
          .getByRole("navigation", { name: "Main navigation" })
          .getByRole("link", { name: "Issues", exact: true }),
      ).toBeVisible();

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
