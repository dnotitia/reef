import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readIndexedDbConfig,
  resetFixture,
  setAkbAccountDenial,
  writeIndexedDbConfig,
} from "./harness/fixture";

test.describe("AKB account denial", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("removed membership clears account state and preserves the denial UX", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);

    await expect
      .poll(() => readIndexedDbConfig(page, "vault"))
      .toBe(REEF_E2E_VAULT);
    await expect
      .poll(() => readIndexedDbConfig(page, "akb_user_id"))
      .toBe("user-alice");

    await writeIndexedDbConfig(
      page,
      `filter:${REEF_E2E_VAULT}`,
      JSON.stringify({ version: 1, filter: { status: ["todo"] } }),
    );
    await writeIndexedDbConfig(page, "theme", "dark");
    await page.evaluate(() => {
      localStorage.setItem(
        "REACT_QUERY_OFFLINE_CACHE",
        JSON.stringify({
          timestamp: Date.now(),
          buster: "",
          clientState: { mutations: [], queries: [] },
        }),
      );
      localStorage.setItem("reef:etag:repos", "previous-account-etag");
    });

    await setAkbAccountDenial(request, "membership_required");
    await page.reload();

    await expect(page).toHaveURL(/\/login\?sso_error=membership_required$/, {
      timeout: 15_000,
    });
    await expect(page.locator("p[role='alert']")).toContainText(
      "does not have workspace access",
    );

    await expect.poll(() => readIndexedDbConfig(page, "vault")).toBe("");
    for (const key of ["akb_user_id", `filter:${REEF_E2E_VAULT}`]) {
      await expect.poll(() => readIndexedDbConfig(page, key)).toBeUndefined();
    }
    await expect.poll(() => readIndexedDbConfig(page, "theme")).toBe("dark");
    await expect
      .poll(() =>
        page.evaluate(() => ({
          queryCache: localStorage.getItem("REACT_QUERY_OFFLINE_CACHE"),
          etag: localStorage.getItem("reef:etag:repos"),
        })),
      )
      .toEqual({ queryCache: null, etag: null });

    const meStatus = await page.evaluate(async () => {
      const response = await fetch("/api/auth/akb/me", {
        credentials: "same-origin",
        cache: "no-store",
      });
      return response.status;
    });
    expect(meStatus).toBe(401);
  });
});
