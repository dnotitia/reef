import { expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "../harness/fixture";

test.describe("Hermetic Reports flow metrics", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("renders the cycle/lead switcher from one vault activity read", async ({
    page,
  }) => {
    const activityRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "GET" &&
        url.pathname === "/api/reports/activity"
      ) {
        activityRequests.push(request.url());
      }
    });

    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/reports");

    const card = page.getByTestId("report-card-flow-metrics");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("flow-metrics-chart")).toBeVisible();
    await expect(card).toContainText("Measurement coverage");
    await expect(card).toContainText("P85 SLE");
    await expect(card.getByTestId("flow-metric-cycle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await card.getByTestId("flow-metric-lead").click();
    await expect(card.getByTestId("flow-metric-lead")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(card.getByTestId("flow-metrics-chart")).toHaveAttribute(
      "aria-label",
      /Lead time/,
    );

    expect(activityRequests).toHaveLength(1);
  });
});
