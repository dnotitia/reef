import { expect, test } from "@playwright/test";
import {
  readFixtureState,
  resetFixture,
  signInAndSelectExistingWorkspace,
} from "./harness/fixture";

const issuePath = "/workspace/reef-e2e/issues/REEF-001";

test.describe("Hermetic issue notification preference", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("persists watch and mute choices for the signed-in actor", async ({
    browser,
    page,
    request,
  }) => {
    await signInAndSelectExistingWorkspace(page);
    await page.goto(issuePath);

    const initialControl = page.getByRole("button", {
      name: "Issue notifications: Watch",
    });
    await expect(initialControl).toBeVisible();
    await initialControl.click();
    await page.getByRole("menuitem", { name: "Watch" }).click();
    await expect(
      page.getByRole("button", {
        name: "Issue notifications: Watching",
      }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("button", {
        name: "Issue notifications: Watching",
      }),
    ).toBeVisible();

    const baseURL = new URL(page.url()).origin;
    const freshContext = await browser.newContext({ baseURL });
    try {
      const freshPage = await freshContext.newPage();
      await signInAndSelectExistingWorkspace(freshPage);
      await freshPage.goto(issuePath);

      const watchingControl = freshPage.getByRole("button", {
        name: "Issue notifications: Watching",
      });
      await expect(watchingControl).toBeVisible();
      await watchingControl.click();
      await freshPage.getByRole("menuitem", { name: "Mute" }).click();
      await expect(
        freshPage.getByRole("button", {
          name: "Issue notifications: Muted",
        }),
      ).toBeVisible();

      await freshPage.reload();
      const mutedControl = freshPage.getByRole("button", {
        name: "Issue notifications: Muted",
      });
      await expect(mutedControl).toBeVisible();
      await mutedControl.click();
      await freshPage.getByRole("menuitem", { name: "Watch" }).click();
      await expect(
        freshPage.getByRole("button", {
          name: "Issue notifications: Watching",
        }),
      ).toBeVisible();

      const tampered = await freshPage.evaluate(async () => {
        const response = await fetch(
          "/api/issues/REEF-001/subscription?vault=reef-e2e",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "mute", subscriber: "bob" }),
          },
        );
        return {
          status: response.status,
          body: await response.json(),
        };
      });
      expect(tampered.status).toBe(400);
      expect(tampered.body).toMatchObject({
        error: "Invalid request body.",
        details: {
          formErrors: ["Unrecognized key(s) in object: 'subscriber'"],
        },
      });

      const effective = await freshPage.evaluate(async () => {
        const response = await fetch(
          "/api/issues/REEF-001/subscription?vault=reef-e2e",
        );
        return {
          status: response.status,
          body: await response.json(),
        };
      });
      expect(effective).toEqual({
        status: 200,
        body: { state: "watching" },
      });

      const fixture = await readFixtureState(request);
      expect(
        fixture.vaults.find(({ name }) => name === "reef-e2e")?.subscriptions,
      ).toEqual([
        {
          reef_id: "REEF-001",
          subscriber: "alice",
          source: "manual",
          status: "active",
        },
      ]);
    } finally {
      await freshContext.close();
    }
  });
});
