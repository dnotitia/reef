import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  resetFixture,
} from "./harness/fixture";

/**
 * REEF-300: the Activity feed's "Scanned …" staleness label must follow the
 * interface language. ActivityRefreshButton used to reimplement its own
 * English-only relative time ("5m ago"); it now shares the locale-aware
 * formatter, so a Korean UI reads "Scanned 지금" / "5분 전" instead of English.
 *
 * Drives the real surface end to end: real login, a real monitored-repo scan
 * through the activity refresh control (the client mutation persists
 * last_scan_at), and the activity page rendered in ko from the NEXT_LOCALE
 * cookie. ("Scanned" itself is the REEF-293 chrome catalog's job and is
 * deliberately out of this issue's scope.)
 */
test.describe("Activity last-scan label i18n (REEF-300)", () => {
  test.beforeEach(async ({ page, request }) => {
    await resetFixture(request, "configured");
    // Real login + select reef-e2e as the active workspace, landing on /issues
    // (the activity page renders an empty-workspace notice without one).
    await openExistingWorkspace(page);

    // Seed a single monitored repo so the scan control is active and targets a
    // repo the activity-scan boundary allows.
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

  test("renders the last-scan relative time in the active locale (ko)", async ({
    page,
  }, testInfo) => {
    // The NEXT_LOCALE cookie is the SSR locale source, so the activity page
    // renders from the ko catalog on first paint.
    const origin = new URL(page.url()).origin;
    await page
      .context()
      .addCookies([{ name: "NEXT_LOCALE", value: "ko", url: origin }]);

    await page.goto("/workspace/reef-e2e/activity");

    // A real scan persists last_scan_at through the client mutation and bumps
    // the re-read; the staleness label then renders the freshly-scanned time.
    // Clicking auto-waits for the control to be enabled (repo resolved, not
    // already scanning).
    await page.getByTestId("activity-refresh").click();

    const label = page.getByTestId("activity-last-scan");
    await expect(label).toBeVisible({ timeout: 15_000 });

    // AC1: the relative time follows the Korean locale ("지금" just-now, or
    // "N분 전" if the round-trip crosses 45s). AC2: no English "now"/"ago" leaks
    // from the removed reimplementation.
    await expect(label).toContainText(/지금|분 전/);
    await expect(label).not.toContainText("now");
    await expect(label).not.toContainText("ago");

    await page.screenshot({
      path: testInfo.outputPath("activity-last-scan-ko.png"),
      fullPage: true,
    });
  });
});
