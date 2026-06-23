import { expect, test } from "@playwright/test";
import { REEF_E2E_VAULT, resetFixture, signInAsAlice } from "./harness/fixture";

/**
 * REEF-289: the activity scan must reject any `owner`/`repo` that the active
 * vault does not list in `monitored_repos`. The boundary lives in the core
 * scanner (`scanAndPersistActivitySuggestions`), which both the manual
 * `POST /api/activity/scan` route and the `activity.scan` agent run funnel
 * through. This spec drives the real manual route end-to-end against the
 * hermetic fixture: an unmonitored repo is rejected with a PM-facing 422, while
 * a monitored repo still scans normally.
 *
 * The fixture configures a GitHub App path through the mock server. The browser
 * request carries only the session cookie; the web route mints a fixture
 * installation token server-side.
 */
const SCAN_AUTH_HEADERS = {
  "Content-Type": "application/json",
};

test.describe("Activity scan monitored-repo boundary (REEF-289)", () => {
  test.beforeEach(async ({ page, request }) => {
    await resetFixture(request, "configured");

    // Real login → the httpOnly __reef_session cookie is set on the browser
    // context and shared by page.request below. Waiting for the onboarding
    // redirect guarantees the login response (and its cookie) landed.
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    // Seed monitored_repos through the real config route so the boundary has a
    // single monitored repo (octo/reef) to allow.
    const patch = await page.request.patch("/api/config", {
      data: {
        vault: REEF_E2E_VAULT,
        patch: {
          monitored_repos: [{ github_id: 1001, owner: "octo", name: "reef" }],
        },
      },
    });
    expect(patch.ok()).toBeTruthy();
  });

  test("rejects a scan of a repo the workspace does not monitor", async ({
    page,
  }) => {
    const res = await page.request.post("/api/activity/scan", {
      headers: SCAN_AUTH_HEADERS,
      data: {
        owner: "octo",
        repo: "not-monitored",
        vault: REEF_E2E_VAULT,
        projectPrefix: "REEF",
      },
    });

    expect(res.status()).toBe(422);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  });

  test("allows a scan of a monitored repo", async ({ page }) => {
    const res = await page.request.post("/api/activity/scan", {
      headers: SCAN_AUTH_HEADERS,
      data: {
        owner: "octo",
        repo: "reef",
        vault: REEF_E2E_VAULT,
        projectPrefix: "REEF",
      },
    });

    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      addedDrafts: number;
      addedStatusChanges: number;
      scannedAt: string;
    };
    expect(body).toMatchObject({
      addedDrafts: expect.any(Number),
      addedStatusChanges: expect.any(Number),
      scannedAt: expect.any(String),
    });
  });
});
