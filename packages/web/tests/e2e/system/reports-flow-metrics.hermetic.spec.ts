import { expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "../harness/fixture";

test.describe("Hermetic Reports flow metrics", () => {
  test.beforeEach(async ({ context, page, request }) => {
    await context.clearCookies();
    const { REPORTS_FIXTURE_NOW } = await import(
      "../harness/mock-fixtures.mjs"
    );
    await page.clock.setFixedTime(new Date(REPORTS_FIXTURE_NOW));
    await resetFixture(request, "configured");
  });

  test("renders reports from one precomputed response and switches cycle/lead locally", async ({
    page,
  }) => {
    const reportRequests: string[] = [];
    const fullDatasetRequests: string[] = [];
    const reportBodies: Promise<unknown>[] = [];
    await openExistingWorkspace(page);

    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname === "/api/reports") {
        reportRequests.push(request.url());
      }
      if (
        request.method() === "GET" &&
        url.pathname === "/api/reports/activity"
      ) {
        fullDatasetRequests.push(request.url());
      }
      if (
        request.method() === "GET" &&
        url.pathname === "/api/issues" &&
        url.searchParams.size === 1 &&
        url.searchParams.has("vault")
      ) {
        fullDatasetRequests.push(request.url());
      }
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (
        response.request().method() === "GET" &&
        url.pathname === "/api/reports"
      ) {
        reportBodies.push(response.json());
      }
    });

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

    expect(reportRequests).toHaveLength(1);
    expect(fullDatasetRequests).toEqual([]);
    const report = (await Promise.all(reportBodies))[0] as Record<
      string,
      unknown
    >;
    expect(report).toHaveProperty("aggregates");
    expect(report).toHaveProperty("flowMetrics");
    expect(report).toHaveProperty("forecast");
    expect(report).toHaveProperty("healthRollup");
    expect(report).toHaveProperty("pivot");
    expect(report).not.toHaveProperty("issues");
    expect(report).not.toHaveProperty("activity");
  });
});
