import { expect, test } from "@playwright/test";
import { resetFixture } from "../harness/fixture";

test.describe("Branded error surfaces", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("serves true branded 404s and recovers through the safe root flow", async ({
    page,
  }) => {
    const firstPath = `/missing-${Date.now()}?from=direct`;
    const response = await page.goto(firstPath);

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "The page you’re looking for doesn’t exist or may have moved.",
      ),
    ).toBeVisible();
    await expect(page.getByText("This page could not be found.")).toHaveCount(
      0,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    const home = page.getByRole("link", { name: "Go to reef home" });
    await expect(home).toHaveAttribute("href", "/");
    await page.keyboard.press("Tab");
    await expect(home).toBeFocused();

    const reloadResponse = await page.reload();
    expect(reloadResponse?.status()).toBe(404);

    const secondResponse = await page.goto(
      `/ghost-workspace/reef-missing-${Date.now()}`,
    );
    expect(secondResponse?.status()).toBe(404);
    await page.getByRole("link", { name: "Go to reef home" }).press("Enter");
    await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
  });

  test("renders unmatched routes entirely from the Korean catalog", async ({
    context,
    page,
  }) => {
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "ko", url: "http://localhost:7353" },
    ]);

    const response = await page.goto(`/없는-경로-${Date.now()}`);

    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "페이지를 찾을 수 없습니다",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "찾으시는 페이지가 없거나 다른 위치로 이동했을 수 있습니다.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "reef 홈으로 이동" }),
    ).toBeVisible();
    await expect(page.getByText("This page could not be found.")).toHaveCount(
      0,
    );
  });

  test("hydrates system-dark preference on a direct 404 and keeps it on reload", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const response = await page.goto(`/dark-missing-${Date.now()}`);

    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveClass(/dark/);

    const darkColors = await page.locator("main").evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, foreground: style.color };
    });
    expect(darkColors.background).not.toBe(darkColors.foreground);

    const reloadResponse = await page.reload();
    expect(reloadResponse?.status()).toBe(404);
    await expect(page.locator("html")).toHaveClass(/dark/);

    const home = page.getByRole("link", { name: "Go to reef home" });
    await page.keyboard.press("Tab");
    await expect(home).toBeFocused();
    await expect(home).toHaveCSS("outline-style", "solid");
    await expect(home).toHaveCSS("outline-width", "2px");
    await expect(home).toHaveCSS("outline-offset", "1px");
    await expect
      .poll(() =>
        home.evaluate((element) => getComputedStyle(element).outlineColor),
      )
      .not.toBe("transparent");
  });
});
