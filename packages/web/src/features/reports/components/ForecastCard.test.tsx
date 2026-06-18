import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MonteCarloForecast } from "../lib/monteCarlo";
import { ForecastCard } from "./ForecastCard";

// 2026-06-01 (UTC) — a fixed `now` so the resolved forecast dates are stable.
const NOW = Date.UTC(2026, 5, 1);

function makeForecast(
  overrides: Partial<MonteCarloForecast> = {},
): MonteCarloForecast {
  return {
    remaining: 12,
    horizonWeeks: 4,
    sampleWeeks: 12,
    totalThroughput: 24,
    productiveWeeks: 10,
    lowConfidence: false,
    insufficient: false,
    completion: [
      { confidence: 50, weeks: 3, capped: false },
      { confidence: 70, weeks: 4, capped: false },
      { confidence: 85, weeks: 5, capped: false },
      { confidence: 95, weeks: 7, capped: false },
    ],
    byDate: [
      { confidence: 50, count: 8 },
      { confidence: 70, count: 6 },
      { confidence: 85, count: 5 },
      { confidence: 95, count: 3 },
    ],
    ...overrides,
  };
}

describe("ForecastCard", () => {
  it("renders all four percentiles for both forecasts (AC3)", () => {
    render(
      <ForecastCard
        forecast={makeForecast()}
        now={NOW}
        periodLabel="Last 12 weeks"
      />,
    );
    for (const c of [50, 70, 85, 95]) {
      expect(
        screen.getByTestId(`forecast-completion-${c}`),
      ).toBeInTheDocument();
      expect(screen.getByTestId(`forecast-bydate-${c}`)).toBeInTheDocument();
    }
  });

  it("resolves completion weeks to a date and keeps the week count (AC1)", () => {
    render(
      <ForecastCard
        forecast={makeForecast()}
        now={NOW}
        periodLabel="Last 12 weeks"
      />,
    );
    // 50% → 3 weeks out from 2026-06-01 = 2026-06-22.
    const row = screen.getByTestId("forecast-completion-50");
    expect(row.textContent).toContain("by Jun 22");
    expect(row.textContent).toContain("3w");
  });

  it("labels the by-date column with the horizon date and at-least counts (AC2)", () => {
    render(
      <ForecastCard
        forecast={makeForecast()}
        now={NOW}
        periodLabel="Last 12 weeks"
      />,
    );
    // Horizon 4 weeks out = 2026-06-29.
    expect(screen.getByText("By Jun 29")).toBeInTheDocument();
    expect(screen.getByTestId("forecast-bydate-50").textContent).toContain("8");
    expect(screen.getByTestId("forecast-bydate-95").textContent).toContain("3");
  });

  it("names the remaining population in the subtitle", () => {
    render(
      <ForecastCard
        forecast={makeForecast({ remaining: 12 })}
        now={NOW}
        periodLabel="Last 12 weeks"
      />,
    );
    expect(screen.getByText("Open work · 12 remaining")).toBeInTheDocument();
  });

  it("shows a low-confidence caption when the sample is thin", () => {
    render(
      <ForecastCard
        forecast={makeForecast({ lowConfidence: true })}
        now={NOW}
        periodLabel="Last 4 weeks"
      />,
    );
    expect(screen.getByTestId("forecast-low-confidence")).toBeInTheDocument();
  });

  it("omits the low-confidence caption for a healthy sample", () => {
    render(
      <ForecastCard
        forecast={makeForecast({ lowConfidence: false })}
        now={NOW}
        periodLabel="Last 12 weeks"
      />,
    );
    expect(
      screen.queryByTestId("forecast-low-confidence"),
    ).not.toBeInTheDocument();
  });

  it("refuses to forecast when there is no throughput history", () => {
    render(
      <ForecastCard
        forecast={makeForecast({
          insufficient: true,
          completion: [],
          byDate: [],
        })}
        now={NOW}
        periodLabel="Last 12 weeks"
      />,
    );
    expect(screen.getByText(/not enough history/i)).toBeInTheDocument();
    expect(
      screen.queryByTestId("forecast-completion-50"),
    ).not.toBeInTheDocument();
  });

  it("shows a done state when no open work remains", () => {
    render(
      <ForecastCard
        forecast={makeForecast({
          remaining: 0,
          completion: [
            { confidence: 50, weeks: 0, capped: false },
            { confidence: 70, weeks: 0, capped: false },
            { confidence: 85, weeks: 0, capped: false },
            { confidence: 95, weeks: 0, capped: false },
          ],
          byDate: [
            { confidence: 50, count: 0 },
            { confidence: 70, count: 0 },
            { confidence: 85, count: 0 },
            { confidence: 95, count: 0 },
          ],
        })}
        now={NOW}
        periodLabel="Last 12 weeks"
      />,
    );
    expect(screen.getByText(/nothing left to forecast/i)).toBeInTheDocument();
    expect(
      screen.queryByTestId("forecast-completion-50"),
    ).not.toBeInTheDocument();
  });

  it("renders a capped completion as a floor with no false date", () => {
    render(
      <ForecastCard
        forecast={makeForecast({
          completion: [
            { confidence: 50, weeks: 6, capped: false },
            { confidence: 70, weeks: 10, capped: false },
            { confidence: 85, weeks: 20, capped: false },
            { confidence: 95, weeks: 520, capped: true },
          ],
        })}
        now={NOW}
        periodLabel="Last 12 weeks"
      />,
    );
    const capped = screen.getByTestId("forecast-completion-95");
    expect(capped.textContent).toContain(">520w");
    expect(capped.textContent).not.toContain("by ");
  });
});
