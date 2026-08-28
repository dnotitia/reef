import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { FlowMetricResult, FlowMetrics } from "../lib/aggregateModel";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FlowMetricsCard } from "./FlowMetricsCard";

function metricResult(
  overrides: Partial<FlowMetricResult> = {},
): FlowMetricResult {
  return {
    completionWindowCount: 3,
    measuredCount: 3,
    coveragePercent: 100,
    points: [
      {
        issueId: "ISSUE-001",
        title: "First sample",
        completionAt: "2026-06-20T00:00:00.000Z",
        elapsedDays: 1,
      },
      {
        issueId: "ISSUE-002",
        title: "Second sample",
        completionAt: "2026-06-21T00:00:00.000Z",
        elapsedDays: 2,
      },
      {
        issueId: "ISSUE-003",
        title: "Long-running sample",
        completionAt: "2026-06-22T00:00:00.000Z",
        elapsedDays: 4,
      },
    ],
    percentiles: { p50: 2, p85: 4, p95: 4 },
    sleDays: 4,
    lowSample: true,
    outliers: [],
    ...overrides,
  };
}

const metrics: FlowMetrics = {
  cycle: metricResult({
    outliers: [
      {
        issueId: "ISSUE-003",
        title: "Long-running sample",
        completionAt: "2026-06-22T00:00:00.000Z",
        elapsedDays: 4,
      },
    ],
  }),
  lead: metricResult({
    points: [
      {
        issueId: "ISSUE-001",
        title: "First sample",
        completionAt: "2026-06-20T00:00:00.000Z",
        elapsedDays: 3,
      },
    ],
    measuredCount: 1,
    coveragePercent: 33.3333333333,
    percentiles: { p50: 3, p85: 3, p95: 3 },
    sleDays: 3,
    outliers: [],
  }),
};

function renderCard(
  props: Partial<React.ComponentProps<typeof FlowMetricsCard>> = {},
) {
  return render(
    <IntlTestProvider>
      <FlowMetricsCard
        metrics={metrics}
        periodLabel="Last 12 weeks"
        vault="reef-acme"
        isPending={false}
        isError={false}
        isFetching={false}
        onRetry={() => {}}
        {...props}
      />
    </IntlTestProvider>,
  );
}

describe("FlowMetricsCard", () => {
  it("renders percentiles, SLE, coverage, chart points, and navigable outliers", () => {
    renderCard();

    const card = screen.getByTestId("report-card-flow-metrics");
    expect(card).toHaveTextContent("Flow metrics");
    expect(card).toHaveTextContent("Measurement coverage");
    expect(card).toHaveTextContent("3/3 · 100%");
    expect(card).toHaveTextContent("P85 SLE: 4 days");
    expect(card).toHaveTextContent("Low sample · 3 measured");
    expect(screen.getByTestId("flow-metrics-chart")).toHaveAttribute(
      "aria-label",
      "Cycle time distribution by completion time",
    );
    expect(
      screen
        .getAllByTestId("flow-metric-point")
        .filter((point) => point.getAttribute("data-outlier") === "true"),
    ).toHaveLength(1);

    const outlier = screen.getByRole("link", {
      name: /ISSUE-003.*Long-running sample/,
    });
    expect(outlier).toHaveAttribute(
      "href",
      "/workspace/reef-acme/issues/ISSUE-003",
    );
  });

  it("switches the single card between Cycle Time and Lead Time", () => {
    renderCard();

    const leadButton = screen.getByTestId("flow-metric-lead");
    fireEvent.click(leadButton);

    expect(leadButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("flow-metrics-chart")).toHaveAttribute(
      "aria-label",
      "Lead time distribution by completion time",
    );
    expect(screen.getByTestId("report-card-flow-metrics")).toHaveTextContent(
      "1/3 · 33%",
    );
    expect(screen.queryByTestId("flow-metrics-outliers-lead")).toBeNull();
  });

  it("keeps loading and retry errors inside the card", () => {
    const onRetry = vi.fn();
    renderCard({ isPending: true });
    expect(screen.getByTestId("flow-metrics-loading")).toBeInTheDocument();

    renderCard({
      isPending: false,
      isError: true,
      onRetry,
    });
    const error = screen.getByTestId("flow-metrics-error");
    expect(error).toHaveTextContent("Flow history couldn't be loaded.");
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows a metric-specific empty state when no sample is measurable", () => {
    renderCard({
      metrics: {
        ...metrics,
        cycle: metricResult({
          completionWindowCount: 2,
          measuredCount: 0,
          coveragePercent: 0,
          points: [],
          percentiles: null,
          sleDays: null,
          lowSample: false,
        }),
      },
    });

    const empty = screen.getByTestId("flow-metrics-empty-cycle");
    expect(empty).toHaveTextContent("No measurable Cycle time completions");
    expect(screen.getByTestId("report-card-flow-metrics")).toHaveTextContent(
      "0/2 · 0%",
    );
    expect(screen.queryByTestId("flow-metrics-chart")).toBeNull();
  });
});
