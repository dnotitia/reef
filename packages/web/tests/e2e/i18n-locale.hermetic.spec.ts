import { expect, test } from "@playwright/test";
import {
  openExistingWorkspace,
  readIndexedDbConfig,
  resetFixture,
} from "./harness/fixture";

test.describe("Hermetic i18n locale switch + persistence", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("defaults to English, switches to Korean, and persists across reload", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/settings/preferences");

    // AC1 — first paint (no locale cookie) is English: <html lang> and the
    // server-rendered language section heading are both en.
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("language-section")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Language", level: 3 }),
    ).toBeVisible();
    await expect(page.getByTestId("locale-option-en")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // AC2 — switching to ko flips the UI immediately: <html lang> updates and the
    // heading re-renders from the ko catalog (proving the provider switched, AC3).
    await page.getByTestId("locale-option-ko").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await expect(
      page.getByRole("heading", { name: "언어", level: 3 }),
    ).toBeVisible();
    await expect(page.getByTestId("locale-option-ko")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // REEF-293 AC1 — the chrome follows the locale, not just the language
    // section: the persistent sidebar nav re-renders from the ko catalog
    // (landmark + the Issues link), proving the string migration switches live.
    const nav = page.getByRole("navigation", { name: "메인 내비게이션" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "이슈" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "새 이슈 (Cmd+N)" }),
    ).toBeVisible();

    // AC2 — persisted to both the Dexie config (canonical) and the readable
    // NEXT_LOCALE cookie (SSR mirror).
    await expect
      .poll(async () => readIndexedDbConfig(page, "locale"))
      .toBe("ko");
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "NEXT_LOCALE")?.value).toBe("ko");

    // AC2 — survives a reload: the server reads the cookie and renders ko on the
    // first paint, with no flash back to English.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await expect(
      page.getByRole("heading", { name: "언어", level: 3 }),
    ).toBeVisible();
    await expect(page.getByTestId("locale-option-ko")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
