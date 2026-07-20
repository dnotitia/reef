import { expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

const isHydrationMessage = (text: string) =>
  /hydrat|did(?:n't| not) match|server rendered HTML/i.test(text);

test.describe("Hermetic settings cache hydration", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("warm settings caches match every settings SSR snapshot", async ({
    page,
  }) => {
    const hydrationErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && isHydrationMessage(msg.text())) {
        hydrationErrors.push(msg.text());
      }
    });
    page.on("pageerror", (error) => {
      if (isHydrationMessage(error.message)) {
        hydrationErrors.push(error.message);
      }
    });

    await openExistingWorkspace(page);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const cache =
              window.localStorage.getItem("REACT_QUERY_OFFLINE_CACHE") ?? "";
            return cache.includes('"vaults"') ? "warm" : "cold";
          }),
        { timeout: 5_000 },
      )
      .toBe("warm");
    const main = page.getByRole("main");

    await page.goto("/workspace/reef-e2e/settings/workspace");
    await expect(main.getByTestId("active-vault-trigger")).toBeVisible();
    await page.reload({ waitUntil: "load" });
    await expect(main.getByTestId("active-vault-trigger")).toBeVisible();

    await page.goto("/workspace/reef-e2e/settings/workspace/members");
    await expect(main.getByTestId("members-section")).toBeVisible();
    await page.reload({ waitUntil: "load" });
    await expect(main.getByTestId("members-section")).toBeVisible();

    await page.goto("/workspace/reef-e2e/settings/deployment");
    await expect(main.getByTestId("settings-group-deployment")).toBeVisible();
    await page.reload({ waitUntil: "load" });
    await expect(main.getByTestId("settings-group-deployment")).toBeVisible();

    await page.goto("/workspace/reef-e2e/settings/preferences");
    await expect(main.getByTestId("settings-group-personal")).toBeVisible();
    await page.reload({ waitUntil: "load" });
    await expect(main.getByTestId("settings-group-personal")).toBeVisible();

    expect(
      hydrationErrors,
      `Unexpected hydration mismatch(es):\n${hydrationErrors.join("\n---\n")}`,
    ).toEqual([]);
  });
});
