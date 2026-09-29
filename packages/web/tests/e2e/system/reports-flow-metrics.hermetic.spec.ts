import { expect, test } from "@playwright/test";
import { ReportResponseSchema } from "@reef/core";
import {
  E2E_MOCK_URL,
  REPORTS_FIXTURE_NOW,
  openExistingWorkspace,
  resetFixture,
} from "../harness/fixture";

test.describe("Hermetic Reports flow metrics", () => {
  test.beforeEach(async ({ context, page, request }) => {
    await context.clearCookies();
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

  test("navigates from a cycle-time outlier to its source issue", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "reports_outliers");

    const discoveryResponse = await request.get(
      `${E2E_MOCK_URL}/__e2e/runtime`,
    );
    expect(discoveryResponse.ok()).toBe(true);
    expect((await discoveryResponse.json()) as unknown).toMatchObject({
      scenarios: expect.arrayContaining(["reports_outliers"]),
      tasks: {
        flow_metrics_outliers: {
          scenario: "reports_outliers",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/reports",
        },
      },
    });

    await openExistingWorkspace(page);
    const reportResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" && url.pathname === "/api/reports"
      );
    });
    await page.goto("/workspace/reef-e2e/reports");

    const reportResponse = await reportResponsePromise;
    expect(reportResponse.ok()).toBe(true);
    const report = ReportResponseSchema.parse(
      (await reportResponse.json()) as unknown,
    );
    expect(report.flowMetrics.cycle).toMatchObject({
      completionWindowCount: 20,
      measuredCount: 20,
      coveragePercent: 100,
      percentiles: { p50: 1, p85: 1, p95: 1 },
      sleDays: 1,
      lowSample: false,
    });
    expect(report.flowMetrics.cycle.outliers).toMatchObject([
      { issueId: "REEF-020", elapsedDays: 28 },
    ]);

    const card = page.getByTestId("report-card-flow-metrics");
    await expect(card).toContainText("Measurement coverage");
    await expect(card).toContainText("20/20 · 100%");
    await expect(card.getByTestId("flow-metrics-outliers-cycle")).toBeVisible();
    const outlier = card
      .getByTestId("flow-metrics-outliers-cycle")
      .getByRole("link", { name: /REEF-020.*Long-running cycle outlier/ });
    await expect(outlier).toHaveAttribute(
      "href",
      "/workspace/reef-e2e/issues/REEF-020",
    );

    await outlier.click();
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/REEF-020$/);
    const issueDetail = page.getByTestId("issue-detail");
    await expect(issueDetail).toBeVisible();
    await expect(issueDetail).toContainText("Long-running cycle outlier");
  });
});
